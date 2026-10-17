package net.worldol.offline;

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
        // 排查用：允许 adb/chrome 远程调试 WebView（inspect 看 console 与运行时状态）。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
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