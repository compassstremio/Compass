package android.content.pm

import compass.compat.host.PlatformHost

class ApplicationInfo {

    @JvmField
    var dataDir: String = PlatformHost.dataDir.absolutePath
}
