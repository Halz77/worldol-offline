# 由 安装环境.ps1 自动生成，请勿手改；重新装环境会覆盖。
# 2026-10-20：打包工具链整体搬到 E:\apk_pack_tool（原在 C 盘用户目录）。
#             用户环境变量 JAVA_HOME / ANDROID_HOME / ANDROID_SDK_ROOT /
#             GRADLE_USER_HOME 已同步指向这里；改目录时这四行要一起改。
$env:JAVA_HOME = 'E:\apk_pack_tool\jdk-21'
$env:ANDROID_HOME = 'E:\apk_pack_tool\android-sdk'
$env:ANDROID_SDK_ROOT = 'E:\apk_pack_tool\android-sdk'
$env:GRADLE_USER_HOME = 'E:\apk_pack_tool\gradle-home'
