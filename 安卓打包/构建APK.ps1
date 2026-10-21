# =============================================================================
#  世界OL 单机版 —— 构建 APK
#
#  前置：先跑过 .\安装环境.ps1（一次性），再跑 .\standalone\build.mjs 生成站点
#  用法：powershell -ExecutionPolicy Bypass -File .\构建APK.ps1
#        可选 -Release 出 release 包（需要自己配签名，默认只出 debug 包，可直接安装）
#             -Fresh   重新生成 android 工程（改了 appId 后使用）
#
#  架构说明（standalone 版）：
#  不再使用 capacitor-nodejs 内嵌 Node 运行时。整套服务端已被 standalone\build.mjs
#  打成 www/worldol-standalone.js，直接在 WebView 的 JS 引擎里跑，文件读写走内存 VFS。
#  因此没有 libnode.so、没有 NDK、没有首次启动解压；WebView 直接读 APK 内的 assets。
# =============================================================================
[CmdletBinding()]
param(
    [switch]$Release,
    [switch]$Fresh,
    [switch]$NoImmersive
)

# 注意：PowerShell 5.1 在 ErrorActionPreference='Stop' 时，npm / npx / gradlew
# 向 stderr 写任何东西都会被当成致命错误，所以这里用 'Continue'，逐条检查 $LASTEXITCODE。
$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

# 统一编码，否则子进程（gradlew / npm）的输出会混编，日志看起来像乱码
try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }
try { $OutputEncoding = New-Object Text.UTF8Encoding $false } catch { }

# 日志由脚本自己在本进程内落盘。
# 千万不要在调用方再套一层 `| Tee-Object`：那是另一个进程，
# 会用它的编码去解码本进程的 UTF-8 字节流，中文就变成“婧愮爜”这种乱码。
$buildLog = Join-Path $PSScriptRoot 'build.log'
$script:transcriptOn = $false
try { Start-Transcript -LiteralPath $buildLog -Force | Out-Null; $script:transcriptOn = $true } catch { }
trap {
    if ($script:transcriptOn) { try { Stop-Transcript | Out-Null } catch { } }
    Write-Host ''
    Write-Host ('[构建失败] ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host ('完整日志：' + $buildLog) -ForegroundColor Red
    exit 1
}

function Write-Step([string]$Text) { Write-Host "`n=== $Text ===" -ForegroundColor Cyan }
function Write-Ok([string]$Text) { Write-Host "  [OK] $Text" -ForegroundColor Green }
function Write-Warn2([string]$Text) { Write-Host "  [!]  $Text" -ForegroundColor Yellow }

$appDir = Join-Path $PSScriptRoot 'app'
$wwwDir = Join-Path $appDir 'www'
$androidDir = Join-Path $appDir 'android'

# 优先使用 安装环境.ps1 生成的环境文件（避免依赖「重开终端」才生效的系统变量）
$envFile = Join-Path $PSScriptRoot '环境.ps1'
if (Test-Path -LiteralPath $envFile) { . $envFile }

# 写文本文件一律用「无 BOM 的 UTF-8」。
# javac 会把 .java 文件开头的 BOM 当成「非法字符」直接报错；
# gradle-wrapper.properties 带 BOM 会让 java.util.Properties 解析失败。
$utf8NoBom = New-Object Text.UTF8Encoding $false

function Remove-Bom([string]$Directory) {
    if (-not (Test-Path -LiteralPath $Directory)) { return 0 }
    $count = 0
    foreach ($pattern in @('*.gradle', '*.java', '*.kt', '*.xml', '*.properties')) {
        Get-ChildItem -LiteralPath $Directory -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '\\build\\' } | ForEach-Object {
                $bytes = [IO.File]::ReadAllBytes($_.FullName)
                if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
                    $out = New-Object byte[] ($bytes.Length - 3)
                    [Array]::Copy($bytes, 3, $out, 0, $out.Length)
                    [IO.File]::WriteAllBytes($_.FullName, $out)
                    $count++
                }
            }
    }
    return $count
}

# ---------------------------------------------------------------------------
Write-Step '1/7 前置检查'
if (-not (Test-Path -LiteralPath (Join-Path $wwwDir 'worldol-standalone.js'))) {
    throw "还没生成独立运行时。请先运行：`n  cd .\standalone; node build.mjs"
}
if (-not (Test-Path -LiteralPath (Join-Path $wwwDir 'standalone-files.json'))) {
    throw '站点不完整（缺少 standalone-files.json）。请重新运行 .\standalone\build.mjs。'
}
# gd.js 必须含 offlineInstall / offlineBootSettings 注入。
# 缺了它，客户端会用原生封包（[uint16 长度][uint16 类型]），与本地服务端的
# [int32 类型] 帧格式对不上，表现为 sendProtoAsync msg:5000 time out。
$bootJs = Join-Path $wwwDir 'gd.js'
if (-not (Test-Path -LiteralPath $bootJs)) {
    throw '站点缺少 gd.js（客户端引导脚本）。请重新运行 .\standalone\build.mjs。'
}
if ((Get-Content -LiteralPath $bootJs -Raw) -notmatch 'offlineInstall') {
    throw 'gd.js 缺少 offlineInstall 注入，站点被旧版构建覆盖过。请重新运行 .\standalone\build.mjs。'
}
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\javac.exe'))) {
    throw 'JAVA_HOME 未设置或无效。请先运行 安装环境.ps1，或手动设置 JAVA_HOME 到 JDK 21。'
}
$javaVersion = ''
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
try { $javaVersion = (& (Join-Path $env:JAVA_HOME 'bin\javac.exe') -version 2>&1) -join '' } finally { $ErrorActionPreference = $prevEap }
if ($javaVersion -notmatch '21\.') { Write-Warn2 ("JAVA_HOME 指向的不是 JDK 21（$javaVersion），构建很可能失败。") }
Write-Ok ("JAVA_HOME = " + $env:JAVA_HOME)

$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
# 打包工具链默认在 E:\apk_pack_tool（2026-10-20 从 C 盘用户目录整体迁出）。
# 环境.ps1 正常存在时上面已取到；这里只是兜底，防止手删环境文件后报错。
if (-not (Test-Path -LiteralPath $sdkRoot)) {
    $toolSdk = 'E:\apk_pack_tool\android-sdk'
    if (Test-Path -LiteralPath $toolSdk) { $sdkRoot = $toolSdk }
}
if (-not (Test-Path -LiteralPath $sdkRoot)) { throw "找不到 Android SDK：$sdkRoot。请先运行 安装环境.ps1。" }
Write-Ok ("ANDROID_HOME = " + $sdkRoot)

# Gradle 用户目录同理（wrapper 发行包与依赖缓存在这里）
if (-not $env:GRADLE_USER_HOME) {
    $toolGradle = 'E:\apk_pack_tool\gradle-home'
    if (Test-Path -LiteralPath $toolGradle) { $env:GRADLE_USER_HOME = $toolGradle }
}
if ($env:GRADLE_USER_HOME) { Write-Ok ("GRADLE_USER_HOME = " + $env:GRADLE_USER_HOME) }

$wwwMB = [math]::Round(((Get-ChildItem -LiteralPath $wwwDir -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Ok ("站点资源 = $wwwMB MB（直接随 APK 发布，无需首次解压）")

# ---------------------------------------------------------------------------
Write-Step '2/7 安装 npm 依赖'
Push-Location $appDir
try {
    if (-not (Test-Path -LiteralPath (Join-Path $appDir 'node_modules'))) {
        Write-Host '  npm install（Capacitor 本体）…'
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
    }
    Write-Ok 'npm 依赖就绪'

    # standalone 版不再需要内嵌 Node 运行时。残留的 capacitor-nodejs 会让 android
    # 工程引用一个已经不存在的 gradle 模块，所以检测到就直接清掉并重建 android 工程。
    $legacyPlugin = Join-Path $appDir 'node_modules\capacitor-nodejs'
    if (Test-Path -LiteralPath $legacyPlugin) {
        Write-Warn2 '检测到遗留的 capacitor-nodejs，正在移除（standalone 版不再使用）'
        Remove-Item -LiteralPath $legacyPlugin -Recurse -Force -ErrorAction SilentlyContinue
    }
    $settingsGradle = Join-Path $androidDir 'capacitor.settings.gradle'
    if (Test-Path -LiteralPath $settingsGradle) {
        if ((Get-Content -LiteralPath $settingsGradle -Raw -Encoding UTF8) -match 'capacitor-nodejs') {
            Write-Warn2 'android 工程仍引用 capacitor-nodejs，自动重建 android 工程'
            $Fresh = $true
        }
    }

    # -----------------------------------------------------------------------
    Write-Step '3/7 生成 / 更新 android 工程'
    if ($Fresh -and (Test-Path -LiteralPath $androidDir)) {
        Write-Host '  -Fresh：删除旧 android 工程'
        Remove-Item -LiteralPath $androidDir -Recurse -Force
    }
    if (-not (Test-Path -LiteralPath $androidDir)) {
        Write-Host '  npx cap add android …'
        & npx cap add android
        if ($LASTEXITCODE -ne 0) { throw 'cap add android 失败' }
    }

    # local.properties：告诉 Gradle SDK 在哪
    $sdkForGradle = $sdkRoot -replace '\\', '/'
    Set-Content -LiteralPath (Join-Path $androidDir 'local.properties') -Value ("sdk.dir=" + $sdkForGradle) -Encoding ASCII

    # -----------------------------------------------------------------------
    Write-Step '4/7 清理工程内 BOM'

    $utf8NoBom = New-Object Text.UTF8Encoding $false

    # 某些模板文件自带 UTF-8 BOM（EF BB BF），Groovy 编译器会直接报
    # "Unexpected character: '\uFEFF' @ line 1, column 1"。
    # 把所有工程内 .gradle 文件开头的 BOM 去掉（没有 BOM 的文件不受影响）。
    $gradleRoots = @($androidDir)
    $stripped = 0
    foreach ($gradleRoot in $gradleRoots) {
        foreach ($gradleFile in (Get-ChildItem -LiteralPath $gradleRoot -Recurse -Filter '*.gradle' -File -ErrorAction SilentlyContinue)) {
            $bytes = [IO.File]::ReadAllBytes($gradleFile.FullName)
            if ($bytes.Length -gt 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
                $rest = New-Object byte[] ($bytes.Length - 3)
                [Array]::Copy($bytes, 3, $rest, 0, $rest.Length)
                [IO.File]::WriteAllBytes($gradleFile.FullName, $rest)
                $stripped++
            }
        }
    }
    Write-Ok ("已清理 $stripped 个 .gradle 文件的 BOM")

    # -----------------------------------------------------------------------
    Write-Step '5/7 调整 AndroidManifest 与入口 Activity'
    $manifest = Join-Path $androidDir 'app\src\main\AndroidManifest.xml'
    if (Test-Path -LiteralPath $manifest) {
        $xml = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8
        if ($xml -notmatch 'screenOrientation') {
            $xml = $xml -replace '<activity', '<activity android:screenOrientation="portrait"'
        }
        if ($xml -notmatch 'largeHeap') {
            $xml = $xml -replace '<application', '<application android:largeHeap="true"'
        }
        [IO.File]::WriteAllText($manifest, $xml, $utf8NoBom)
        Write-Ok '已设置竖屏 + 大内存堆'
    }

    if (-not $NoImmersive) {
        $appId = (Get-Content -LiteralPath (Join-Path $appDir 'capacitor.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json).appId
        $pkgPath = Join-Path $androidDir ('app\src\main\java\' + ($appId -replace '\.', '\'))
        $javaMain = Join-Path $pkgPath 'MainActivity.java'
        $ktMain = Join-Path $pkgPath 'MainActivity.kt'
        if (Test-Path -LiteralPath $javaMain) {
            $activity = @"
package $appId;

import android.content.ContentValues;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

// WORLDOL_ACTIVITY_V2
// 注意：这份源码同时存在于两处 —— `安卓打包/构建APK.ps1` 内嵌模板与 android 工程里。
// 构建脚本默认用它覆盖工程里的同名文件；看到上面这行标记就会跳过覆盖。
// 改动请务必两处同步。
public class MainActivity extends BridgeActivity {
    private static final String BOOT_PREF = "worldol-boot";
    private static final String PREF_BUILD_ID = "buildId";
    private static final String BUILD_FILE = "public/build-version.json";

    // 本次启动是否执行过缓存清理（删目录在 super 之前，清 WebView 在拿到桥之后）
    private boolean assetCacheCleared = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须赶在 super 之前：BridgeActivity.onCreate 会立刻加载首页，
        // 之后清缓存就晚了 —— 页面已经把旧资源读进了 WebView。
        clearStaleAssetCache();
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUi();
        installExportBridge();
        if (assetCacheCleared) flushWebViewCache();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    // ---- 缓存自愈 ------------------------------------------------------
    //
    // 为什么需要：站点文件随 APK 发布在 assets/public 里，覆盖安装后本身就是新的；
    // 但 WebView 把 /v/gd/305.json、主包 js 这些请求的响应缓存到了 App 私有目录，
    // 而覆盖安装不动私有数据。于是「补丁在 APK 里，界面还是上一版」，只有卸载
    // 重装（整个私有目录被清）才正常 —— 不能指望用户为了看改动而丢存档。
    //
    // 做法：构建期产出 public/build-version.json（站点产物的整体哈希），启动时与
    // 上次记下的指纹比对，变了就删掉缓存目录。同一个指纹只清一次。
    //
    // 关键约束：只删缓存目录，绝不能碰 Local Storage / IndexedDB —— 单机存档
    // 存在 localStorage（键前缀 worldol-fs:）里，删掉等于丢档。
    private void clearStaleAssetCache() {
        try {
            SharedPreferences pref = getSharedPreferences(BOOT_PREF, MODE_PRIVATE);
            String buildId = readBuildId();
            String last = pref.getString(PREF_BUILD_ID, null);
            if (buildId != null && buildId.equals(last)) return;
            purgeCacheDirs(new File(getApplicationInfo().dataDir), 0);
            assetCacheCleared = true;
            pref.edit().putString(PREF_BUILD_ID, buildId == null ? "" : buildId).apply();
        } catch (Exception error) {
            // 清理失败不能挡住启动
        }
    }

    /** 补一刀：删文件万一有残留（比如厂商改了缓存目录名），让 WebView 自己再清一次。 */
    private void flushWebViewCache() {
        try {
            com.getcapacitor.Bridge bridge = getBridge();
            if (bridge == null) return;
            WebView webView = bridge.getWebView();
            if (webView != null) webView.clearCache(true);
        } catch (Exception ignored) {
            // 有的 ROM 上这个方法会抛异常，删目录那一步已经够了
        }
    }

    /** 读 APK 里随包发布的构建指纹；文件不存在或格式不对返回 null（老版本 APK 的情形）。 */
    private String readBuildId() {
        InputStream in = null;
        try {
            in = getAssets().open(BUILD_FILE);
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
            String id = new JSONObject(text.toString()).optString("id", "");
            return id.isEmpty() ? null : id;
        } catch (Exception error) {
            return null;
        } finally {
            if (in != null) {
                try { in.close(); } catch (Exception ignored) { /* ignore */ }
            }
        }
    }

    /** 递归删掉所有缓存目录。depth 限制避免遍历到深不见底的路径。 */
    private void purgeCacheDirs(File dir, int depth) {
        if (dir == null || depth > 6) return;
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (!child.isDirectory()) continue;
            if (isCacheDirName(child.getName())) deleteRecursively(child);
            else purgeCacheDirs(child, depth + 1);
        }
    }

    private boolean isCacheDirName(String name) {
        // WebView 各版本的缓存目录名：Chromium 放在 app_webview/Default 下，
        // 老版本用 app_webview/Cache 或 cache/WebView。
        return name.equals("Cache")
                || name.equals("HTTP Cache")
                || name.equals("Code Cache")
                || name.equals("GPUCache")
                || name.equals("ShaderCache")
                || name.equals("WebView");
    }

    private void deleteRecursively(File target) {
        File[] children = target.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        target.delete();
    }

    /**
     * 存档导出：把页面传来的文本写成手机上的真实文件。
     *
     * WebView 默认丢弃 <a download>（不写任何文件），所以导出必须由原生接住。
     * 页面里调 window.WorldolExport.save(fileName, content)，返回：
     *   "OK|"  + 可显示的保存位置
     *   "ERR|" + 原因
     * 这里只用 ASCII 字面量，避免 Gradle 编译源码时的编码问题；
     * 中文提示一律由页面拼。
     */
    private void installExportBridge() {
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.addJavascriptInterface(new ExportBridge(), "WorldolExport");
        }
    }

    private class ExportBridge {
        @JavascriptInterface
        public String save(String fileName, String content) {
            String name = sanitize(fileName);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+：写公共「下载」目录，不需要任何权限。
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "ERR|cannot create file in Downloads";
                    OutputStream out = getContentResolver().openOutputStream(uri);
                    if (out == null) return "ERR|cannot open Downloads file";
                    try {
                        out.write(content.getBytes(StandardCharsets.UTF_8));
                    } finally {
                        out.close();
                    }
                    return "OK|Download/" + name;
                }
                // Android 9 及以下：公共下载目录需要存储权限，改为 App 专属外部目录（无需权限）。
                File dir = getExternalFilesDir(null);
                if (dir == null) dir = getFilesDir();
                File target = new File(dir, name);
                FileOutputStream out = new FileOutputStream(target);
                try {
                    out.write(content.getBytes(StandardCharsets.UTF_8));
                } finally {
                    out.close();
                }
                return "OK|" + target.getAbsolutePath();
            } catch (Exception error) {
                String message = error.getMessage();
                return "ERR|" + (message == null ? error.getClass().getSimpleName() : message);
            }
        }

        /** 只接受纯文件名，避免被写到别的目录去。 */
        private String sanitize(String fileName) {
            String name = (fileName == null ? "" : fileName).replace('\\', '_').replace('/', '_').trim();
            return name.isEmpty() ? "worldol-save.json" : name;
        }
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
}
"@
            # 工程里那份如果已经带 WORLDOL_ACTIVITY_V2 标记，说明是人工维护的版本，
            # 不能再覆盖 —— 否则每次构建都会被这里的模板冲掉，编进 dex 的还是旧代码。
            $currentActivity = Get-Content -LiteralPath $javaMain -Raw -Encoding UTF8
            if ($currentActivity -match 'WORLDOL_ACTIVITY_V2') {
                Write-Ok 'MainActivity 已是自定义版本，保留不覆盖'
            } else {
                [IO.File]::WriteAllText($javaMain, $activity, $utf8NoBom)
                Write-Ok '已注入沉浸式全屏 MainActivity（无 BOM，避免 javac 非法字符）'
            }
        } elseif (Test-Path -LiteralPath $ktMain) {
            Write-Warn2 'MainActivity 是 Kotlin，跳过沉浸式注入（不影响可玩性）'
        } else {
            Write-Warn2 '未找到 MainActivity，跳过沉浸式注入'
        }
    }

    # -----------------------------------------------------------------------
    Write-Step '6/7 配置国内镜像 + 同步 web 资源'

    # 国内直连 services.gradle.org / dl.google.com 基本会超时，统一改成镜像。
    # 注意：写入时用「无 BOM 的 UTF-8」，否则 java.util.Properties 读 gradle-wrapper.properties 会出错。
    $wrapperProps = Join-Path $androidDir 'gradle\wrapper\gradle-wrapper.properties'
    if (Test-Path -LiteralPath $wrapperProps) {
        $text = Get-Content -LiteralPath $wrapperProps -Raw -Encoding UTF8
        if ($text -match 'distributionUrl=(\S*?gradle-[\d\.]+-(?:all|bin)\.zip)') {
            $original = $Matches[1]
            if ($original -notmatch 'mirrors') {
                $file = ($original -split '/')[-1]
                $text = $text.Replace($original, 'https\://mirrors.cloud.tencent.com/gradle/' + $file)
                [IO.File]::WriteAllText($wrapperProps, $text, $utf8NoBom)
                Write-Ok ("Gradle 发行包镜像 -> mirrors.cloud.tencent.com/gradle/" + $file)
            } else { Write-Ok 'Gradle 发行包镜像已配置' }
        } else { Write-Warn2 '没识别到 distributionUrl，跳过' }
    }

    $rootGradle = Join-Path $androidDir 'build.gradle'
    if (Test-Path -LiteralPath $rootGradle) {
        $text = Get-Content -LiteralPath $rootGradle -Raw -Encoding UTF8
        if ($text -notmatch 'maven\.aliyun\.com') {
            $mirrors = "        maven { url 'https://maven.aliyun.com/repository/google' }`r`n" +
                       "        maven { url 'https://maven.aliyun.com/repository/public' }`r`n" +
                       "        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }`r`n"
            $text = $text -replace '(buildscript\s*\{\s*repositories\s*\{)', ("`$1`r`n" + $mirrors)
            $text = $text -replace '(allprojects\s*\{\s*repositories\s*\{)', ("`$1`r`n" + $mirrors)
            [IO.File]::WriteAllText($rootGradle, $text, $utf8NoBom)
            Write-Ok 'Maven 仓库镜像 -> maven.aliyun.com'
        } else { Write-Ok 'Maven 镜像已配置' }
    }

    & npx cap sync android
    if ($LASTEXITCODE -ne 0) { throw 'cap sync android 失败' }

    # Gradle 内存与并行；overridePathCheck 是本项目放在中文目录下的必要开关
    $gradleProps = Join-Path $androidDir 'gradle.properties'
    $props = if (Test-Path -LiteralPath $gradleProps) { Get-Content -LiteralPath $gradleProps -Raw -Encoding UTF8 } else { '' }
    if ($props -notmatch 'org\.gradle\.jvmargs') { $props += "`norg.gradle.jvmargs=-Xmx4096m -Dfile.encoding=UTF-8`n" }
    if ($props -notmatch 'org\.gradle\.parallel') { $props += "org.gradle.parallel=true`n" }
    if ($props -notmatch 'android\.enableJetifier') { $props += "android.enableJetifier=false`n" }
    # 项目目录包含中文（源码 / 世界OL_源码 / 安卓打包），AGP 默认会直接拒绝。
    if ($props -notmatch 'android\.overridePathCheck') { $props += "android.overridePathCheck=true`n" }
    [IO.File]::WriteAllText($gradleProps, $props, $utf8NoBom)
    Write-Ok 'gradle.properties 已调整（含 android.overridePathCheck）'

    # javac / AGP 对 BOM 零容忍
    $removed = Remove-Bom $androidDir
    if ($removed -gt 0) { Write-Ok ("已清除 $removed 个文件的 UTF-8 BOM") } else { Write-Ok '未发现多余的 BOM' }

    # -----------------------------------------------------------------------
    Write-Step '7/7 开始编译 APK（首次 5–15 分钟）'
    $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    Push-Location $androidDir
    try {
        $gradlew = Join-Path $androidDir 'gradlew.bat'
        if (-not (Test-Path -LiteralPath $gradlew)) {
            throw '找不到 gradlew.bat，android 工程可能没生成成功。'
        }
        # 日志乱码的根因：Gradle 的 JVM 按平台默认（GBK）输出，而终端的解码方式不一致。
        # 这里把两边都钉死成 UTF-8（chcp 65001 + JVM 输出编码）。
        $env:GRADLE_OPTS = '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8'
        $env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8'
        & cmd.exe /c "chcp 65001 >nul & `"$gradlew`" $task --no-daemon --console=plain"
        if ($LASTEXITCODE -ne 0) { throw ("Gradle 构建失败（退出码 " + $LASTEXITCODE + "）") }
    } finally { Pop-Location }

    $apkDir = Join-Path $androidDir ('app\build\outputs\apk\' + $(if ($Release) { 'release' } else { 'debug' }))
    $apk = Get-ChildItem -LiteralPath $apkDir -Filter '*.apk' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1

    Write-Host ''
    if ($apk) {
        Write-Host '================ 构建成功 ================' -ForegroundColor Green
        Write-Host ("APK   : " + $apk.FullName)
        Write-Host ("体积  : {0:N0} MB" -f ($apk.Length / 1MB))
        Write-Host ''
        Write-Host '安装到手机：' -ForegroundColor Yellow
        Write-Host ("  adb install -r `"" + $apk.FullName + "`"")
        Write-Host '  或把 APK 拷进手机后点击安装（需允许“未知来源”）。'
        Write-Host ''
        Write-Host '站点资源随 APK 一起发布，WebView 直接读取，首次打开无需解压。'
        Write-Host '存档保存在应用私有目录，卸载才会清空。'
    } else {
        Write-Warn2 '构建命令成功，但没找到 APK，请检查上面的输出。'
    }

    if ($script:transcriptOn) { try { Stop-Transcript | Out-Null } catch { } }
} finally {
    Pop-Location
}
