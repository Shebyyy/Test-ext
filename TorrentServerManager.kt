package ani.dantotsu.torrent

import android.content.Context
import ani.dantotsu.settings.saving.PrefManager
import ani.dantotsu.settings.saving.PrefName
import ani.dantotsu.util.Logger
import eu.kanade.tachiyomi.data.torrentServer.model.FileStat
import eu.kanade.tachiyomi.data.torrentServer.model.Torrent
import org.libtorrent4j.*
import org.libtorrent4j.alerts.Alert
import org.libtorrent4j.alerts.ReadPieceAlert
import java.io.File

class TorrentServerManager(private val context: Context) {
    private val sessionManager = SessionManager()
    private var httpServer: TorrentHttpServer? = null
    var activeTorrentHash: String? = null
    var serverPort: Int = 8090
        private set

    init {
        sessionManager.addListener(object : AlertListener {
            override fun types(): IntArray? = null
            override fun alert(alert: Alert<*>) {
                if (alert is ReadPieceAlert) {
                    httpServer?.onReadPieceAlert(alert)
                }
            }
        })
    }

    fun start() {
        if (sessionManager.isRunning) return
        Logger.log("Starting built-in TorrentServerManager...")
        try {
            val settings = SettingsPack()
            settings.setBoolean(org.libtorrent4j.swig.settings_pack.bool_types.enable_upnp.swigValue(), true)
            settings.setBoolean(org.libtorrent4j.swig.settings_pack.bool_types.enable_natpmp.swigValue(), true)
            settings.setBoolean(org.libtorrent4j.swig.settings_pack.bool_types.enable_lsd.swigValue(), true)
            settings.setBoolean(org.libtorrent4j.swig.settings_pack.bool_types.enable_dht.swigValue(), true)
            val params = SessionParams(settings)
            sessionManager.start(params)
            sessionManager.startDht()

            serverPort = findFreePort(8090)
            httpServer = TorrentHttpServer(serverPort, { hash ->
                try {
                    sessionManager.find(Sha1Hash.parseHex(hash))
                } catch (e: Exception) {
                    null
                }
            }, {
                getTorrentCacheDir().absolutePath
            })
            httpServer?.start()
            Logger.log("TorrentServerManager started. Port: $serverPort")
        } catch (e: Exception) {
            Logger.log("Failed to start TorrentServerManager: ${e.message}")
            e.printStackTrace()
        }
    }

    fun stop() {
        Logger.log("Stopping built-in TorrentServerManager...")
        httpServer?.stop()
        httpServer = null
        if (sessionManager.isRunning) {
            sessionManager.stop()
        }
    }

    fun isRunning(): Boolean {
        return sessionManager.isRunning
    }

    fun isAvailable(andEnabled: Boolean = true): Boolean {
        return if (andEnabled) {
            PrefManager.getVal(PrefName.TorrentEnabled)
        } else {
            true
        }
    }

    fun addTorrent(
        url: String,
        title: String,
        poster: String = "",
        data: String = "",
        save: Boolean = false
    ): Torrent {
        start() // Ensure running

        val cacheDir = getTorrentCacheDir()
        var handle: TorrentHandle? = null

        if (url.startsWith("magnet:")) {
            sessionManager.download(url, cacheDir, TorrentFlags.SEQUENTIAL_DOWNLOAD)
            val infoHash = parseMagnetHash(url)
            val sha1 = Sha1Hash.parseHex(infoHash)
            handle = sessionManager.find(sha1)

            // Wait for metadata (up to 30 seconds)
            var waitTime = 0
            while ((handle == null || handle.torrentFile() == null) && waitTime < 300) {
                Thread.sleep(100)
                handle = sessionManager.find(sha1)
                waitTime++
            }
        } else if (url.startsWith("http://") || url.startsWith("https://")) {
            val tempFile = downloadTorrentFile(url)
            if (tempFile != null) {
                val ti = TorrentInfo(tempFile)
                val p = Priority.array(Priority.IGNORE, ti.numFiles())
                sessionManager.download(ti, cacheDir, p, TorrentFlags.SEQUENTIAL_DOWNLOAD)
                handle = sessionManager.find(ti.infoHash())
            }
        } else {
            val file = File(url)
            if (file.exists()) {
                val ti = TorrentInfo(file)
                val p = Priority.array(Priority.IGNORE, ti.numFiles())
                sessionManager.download(ti, cacheDir, p, TorrentFlags.SEQUENTIAL_DOWNLOAD)
                handle = sessionManager.find(ti.infoHash())
            }
        }

        if (handle == null) {
            throw Exception("Failed to add torrent: $url")
        }

        val infoHash = handle.infoHash().toHex()
        val name = handle.getName() ?: title
        val size = handle.torrentFile()?.totalSize() ?: 0L

        val fileStats = handle.torrentFile()?.files()?.let { fileStorage ->
            List(fileStorage.numFiles()) { i ->
                FileStat(
                    id = i,
                    path = fileStorage.filePath(i),
                    length = fileStorage.fileSize(i)
                )
            }
        } ?: emptyList()

        return Torrent(
            title = title,
            name = name,
            hash = infoHash,
            torrent_size = size,
            file_stats = fileStats
        )
    }

    fun getLink(torrent: Torrent, fileIndex: Int): String {
        return "http://127.0.0.1:$serverPort/stream?hash=${torrent.hash}&index=$fileIndex"
    }

    fun getLink(torrentHash: String, fileIndex: Int): String {
        return "http://127.0.0.1:$serverPort/stream?hash=$torrentHash&index=$fileIndex"
    }

    fun removeTorrent(torrentHash: String) {
        try {
            val sha1 = Sha1Hash.parseHex(torrentHash)
            val handle = sessionManager.find(sha1)
            if (handle != null && handle.isValid) {
                sessionManager.remove(handle)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getTorrentCacheDir(): File {
        val dir = File(context.cacheDir, "torrent_cache")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    private fun findFreePort(startPort: Int): Int {
        var port = startPort
        while (port < 65535) {
            try {
                java.net.ServerSocket(port).use {
                    return port
                }
            } catch (e: java.io.IOException) {
                port++
            }
        }
        return startPort
    }

    private fun parseMagnetHash(url: String): String {
        val xtIndex = url.indexOf("xt=urn:btih:")
        if (xtIndex != -1) {
            var hash = url.substring(xtIndex + 12)
            val ampersandIndex = hash.indexOf("&")
            if (ampersandIndex != -1) {
                hash = hash.substring(0, ampersandIndex)
            }
            return hash.uppercase()
        }
        throw IllegalArgumentException("Invalid magnet link")
    }

    private fun downloadTorrentFile(url: String): File? {
        try {
            val client = okhttp3.OkHttpClient()
            val request = okhttp3.Request.Builder().url(url).build()
            client.newCall(request).execute().use { response ->
                if (response.isSuccessful) {
                    val bytes = response.body?.bytes() ?: return null
                    val tempFile = File.createTempFile("temp", ".torrent", context.cacheDir)
                    tempFile.writeBytes(bytes)
                    return tempFile
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return null
    }
}
