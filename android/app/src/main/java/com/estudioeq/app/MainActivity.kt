package com.estudioeq.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.MediaStore
import android.provider.Settings
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: AudioWebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor()
    private var mediaObserverRegistered = false
    private var pageLoaded = false
    private var lastTracksJson: String = ""

    private val scanDebounce = Runnable {
        scanAndPush("observer")
    }

    private val mediaObserver = object : ContentObserver(mainHandler) {
        override fun onChange(selfChange: Boolean, uri: Uri?) {
            super.onChange(selfChange, uri)
            mainHandler.removeCallbacks(scanDebounce)
            mainHandler.postDelayed(scanDebounce, 850L)
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        val granted = hasAudioPermission()
        pushPermissionState(granted)
        if (granted) {
            ensureMediaObserver()
            scanAndPush("permission")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#1B1730")
        window.navigationBarColor = Color.parseColor("#1B1730")

        webView = AudioWebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#1B1730"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = false
                allowContentAccess = true
                cacheMode = WebSettings.LOAD_DEFAULT
            }
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?
                ): WebResourceResponse? {
                    val url = request?.url ?: return null
                    if (url.scheme == "https" && url.host == "estudioeq.local") {
                        val path = url.path ?: "/"
                        if (path.startsWith("/media/")) {
                            val id = path.removePrefix("/media/").toLongOrNull() ?: return null
                            return MusicScanner.openMediaResponse(
                                applicationContext,
                                id,
                                request.requestHeaders ?: emptyMap()
                            )
                        }
                        return openAssetResponse(path)
                    }
                    return null
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    pageLoaded = true
                    if (hasAudioPermission()) {
                        ensureMediaObserver()
                        scanAndPush("init")
                    } else {
                        pushPermissionState(false)
                        requestRequiredPermissions()
                    }
                }
            }
        }

        setContentView(webView)

        PlaybackService.commandHandler = { cmd, arg ->
            mainHandler.post {
                val safeCmd = JSONObject.quote(cmd)
                webView.evaluateJavascript("window.__nativeCmd && window.__nativeCmd($safeCmd, $arg);", null)
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Envía la tarea al fondo sin cerrar el motor de audio
                moveTaskToBack(true)
            }
        })

        webView.loadUrl("https://estudioeq.local/index.html")
    }

    override fun onResume() {
        super.onResume()
        if (pageLoaded && hasAudioPermission()) {
            ensureMediaObserver()
            scanAndPush("observer")
        }
    }

    private fun openAssetResponse(rawPath: String): WebResourceResponse {
        val clean = rawPath.trimStart('/').ifEmpty { "index.html" }
        val mime = when {
            clean.endsWith(".html") -> "text/html"
            clean.endsWith(".js") -> "text/javascript"
            clean.endsWith(".css") -> "text/css"
            clean.endsWith(".json") -> "application/json"
            clean.endsWith(".png") -> "image/png"
            clean.endsWith(".svg") -> "image/svg+xml"
            else -> "application/octet-stream"
        }
        return try {
            val stream = assets.open(clean)
            WebResourceResponse(
                mime,
                "UTF-8",
                200,
                "OK",
                mapOf("Access-Control-Allow-Origin" to "*"),
                stream
            )
        } catch (_: Exception) {
            WebResourceResponse(
                "text/plain",
                "UTF-8",
                404,
                "Not Found",
                mapOf("Access-Control-Allow-Origin" to "*"),
                ByteArrayInputStream(ByteArray(0))
            )
        }
    }

    private fun hasAudioPermission(): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Manifest.permission.READ_MEDIA_AUDIO
        } else {
            Manifest.permission.READ_EXTERNAL_STORAGE
        }
        return ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestRequiredPermissions() {
        val perms = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.READ_MEDIA_AUDIO)
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        } else {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        permissionLauncher.launch(perms.toTypedArray())
    }

    private fun ensureMediaObserver() {
        if (mediaObserverRegistered) return
        try {
            contentResolver.registerContentObserver(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                true,
                mediaObserver
            )
            mediaObserverRegistered = true
        } catch (_: Exception) {
        }
    }

    private fun pushPermissionState(granted: Boolean) {
        mainHandler.post {
            if (!pageLoaded) return@post
            webView.evaluateJavascript("window.__onNativePermission && window.__onNativePermission($granted);", null)
        }
    }

    private fun scanAndPush(reason: String) {
        if (!hasAudioPermission()) {
            pushPermissionState(false)
            return
        }
        ioExecutor.execute {
            val json = MusicScanner.queryTracksJson(applicationContext)
            if (reason == "observer" && json == lastTracksJson) {
                return@execute
            }
            lastTracksJson = json
            val quotedJson = JSONObject.quote(json)
            val quotedReason = JSONObject.quote(reason)
            mainHandler.post {
                if (!pageLoaded) return@post
                webView.evaluateJavascript(
                    "window.__onNativeTracks && window.__onNativeTracks($quotedJson, $quotedReason);",
                    null
                )
            }
        }
    }

    inner class AndroidBridge {

        @JavascriptInterface
        fun hasMusicPermission(): Boolean = hasAudioPermission()

        @JavascriptInterface
        fun requestMusicPermission() {
            mainHandler.post { requestRequiredPermissions() }
        }

        @JavascriptInterface
        fun rescanMusic() {
            scanAndPush("manual")
        }

        @JavascriptInterface
        fun updatePlaybackState(
            title: String,
            artist: String,
            isPlaying: Boolean,
            positionMs: Long,
            durationMs: Long
        ) {
            val intent = Intent(applicationContext, PlaybackService::class.java).apply {
                action = PlaybackService.ACTION_UPDATE
                putExtra(PlaybackService.EXTRA_TITLE, title)
                putExtra(PlaybackService.EXTRA_ARTIST, artist)
                putExtra(PlaybackService.EXTRA_PLAYING, isPlaying)
                putExtra(PlaybackService.EXTRA_POS, positionMs)
                putExtra(PlaybackService.EXTRA_DUR, durationMs)
            }
            try {
                if (isPlaying) {
                    ContextCompat.startForegroundService(applicationContext, intent)
                } else if (PlaybackService.isRunning) {
                    applicationContext.startService(intent)
                }
            } catch (_: Exception) {
            }
        }

        @JavascriptInterface
        fun vibrate(ms: Long) {
            val dur = ms.coerceIn(5L, 250L)
            try {
                val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vm?.defaultVibrator
                } else {
                    @Suppress("DEPRECATION")
                    getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                }
                if (vibrator?.hasVibrator() == true) {
                    vibrator.vibrate(VibrationEffect.createOneShot(dur, VibrationEffect.DEFAULT_AMPLITUDE))
                }
            } catch (_: Exception) {
            }
        }

        @JavascriptInterface
        fun isIgnoringBatteryOptimizations(): Boolean {
            val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return true
            return pm.isIgnoringBatteryOptimizations(packageName)
        }

        @JavascriptInterface
        @SuppressLint("BatteryLife")
        fun openBatterySettings() {
            mainHandler.post {
                try {
                    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                            data = Uri.parse("package:$packageName")
                        }
                        startActivity(intent)
                    }
                } catch (_: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        if (mediaObserverRegistered) {
            try {
                contentResolver.unregisterContentObserver(mediaObserver)
            } catch (_: Exception) {
            }
            mediaObserverRegistered = false
        }
        if (isFinishing) {
            PlaybackService.commandHandler = null
            ioExecutor.shutdownNow()
            webView.destroy()
        }
        super.onDestroy()
    }
}
