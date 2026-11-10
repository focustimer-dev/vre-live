package work.samelling.vrelive.lab

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import androidx.webkit.JavaScriptReplyProxy
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import androidx.webkit.WebViewAssetLoader

/**
 * Packaged VRE interface with a same-origin preview API.
 */
class MainActivity : Activity() {
    private val host = "vre-live-lab-preview.samelling.workers.dev"
    private val assetPath = "/__vre_android__/"
    private val launchUrl = "https://$host${assetPath}app/index.html"
    private val boardAction = "work.samelling.vrelive.lab.OPEN_BOARD"
    private val stationCode = Regex("[0-9A-Z]{2}")
    private val feedPaths = setOf(
        "/feed/history", "/feed/TripUpdateFeed", "/feed/VehiclePositionFeed", "/feed/AlertFeed"
    )
    private lateinit var webView: WebView
    private lateinit var errorPanel: LinearLayout
    private var mainFrameFailed = false
    private var alertArmed = false
    private var alertPermissionReply: JavaScriptReplyProxy? = null
    private val alertChannel = "ride_arrival"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(9, 9, 11)
        window.navigationBarColor = Color.rgb(9, 9, 11)
        setContentView(R.layout.activity_main)
        val root = findViewById<FrameLayout>(R.id.root)
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                insets
            }
            root.requestApplyInsets()
        } else root.fitsSystemWindows = true

        webView = findViewById(R.id.trainWebView)
        errorPanel = findViewById(R.id.errorPanel)
        findViewById<Button>(R.id.retry).setOnClickListener {
            errorPanel.visibility = View.GONE
            openEntryPoint(intent)
        }
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            safeBrowsingEnabled = true
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.setBackgroundColor(Color.rgb(9, 9, 11))
        val assets = WebViewAssetLoader.Builder()
            .setDomain(host)
            .addPathHandler(assetPath, WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        val shortcuts = getSystemService(ShortcutManager::class.java)
        if (shortcuts != null && shortcuts.isRequestPinShortcutSupported &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        ) {
            WebViewCompat.addWebMessageListener(webView, "VreStationShortcut", setOf("https://$host")) {
                    view, message, origin, isMainFrame, _ ->
                if (isMainFrame && isPreviewOrigin(origin) &&
                    Uri.parse(view.url.orEmpty()).path == Uri.parse(launchUrl).path
                ) pinStation(shortcuts, message.data.orEmpty())
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "VreRideAlert", setOf("https://$host")) {
                    view, message, origin, isMainFrame, reply ->
                if (isMainFrame && isPreviewOrigin(origin) &&
                    Uri.parse(view.url.orEmpty()).path == Uri.parse(launchUrl).path
                ) handleRideAlert(message.data.orEmpty(), reply)
            }
        }
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isPreviewOrigin(uri) && uri.path == "${assetPath}app/index.html") return false
                if (request.isForMainFrame && request.hasGesture() &&
                    uri.scheme == "https" && uri.host != host
                ) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) {}
                }
                return true
            }
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val uri = request.url
                if (isPreviewOrigin(uri)) {
                    val path = uri.path.orEmpty()
                    val method = request.method
                    if (path.startsWith(assetPath) && method == "GET") {
                        assets.shouldInterceptRequest(uri)?.let { return it }
                    }
                    if (!request.isForMainFrame &&
                        ((path in feedPaths && (method == "GET" || method == "HEAD")) ||
                            (path == "/login" && method == "POST"))
                    ) return null
                }
                return WebResourceResponse(
                    "text/plain", "UTF-8", 403, "Forbidden", emptyMap(),
                    "Request blocked".byteInputStream()
                )
            }
            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                alertArmed = false
                alertPermissionReply = null
                mainFrameFailed = false
                errorPanel.visibility = View.GONE
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    mainFrameFailed = true
                    errorPanel.visibility = View.VISIBLE
                }
            }
            override fun onPageFinished(view: WebView, url: String?) {
                if (!mainFrameFailed) errorPanel.visibility = View.GONE
            }
        }
        openEntryPoint(intent)
    }

    private fun handleRideAlert(data: String, reply: JavaScriptReplyProxy) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        when (data) {
            "cancel" -> {
                alertArmed = false
                alertPermissionReply = null
                manager.cancel(1)
                return
            }
            "arm" -> {
                if (alertPermissionReply != null) return
                if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                ) {
                    alertPermissionReply = reply
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 41)
                } else completeAlertOptIn(reply)
                return
            }
        }
        if (!alertArmed || data.length > 200) return
        val arrival = runCatching { JSONObject(data) }.getOrNull() ?: return
        val title = arrival.optString("arrival").take(120)
        if (title.isBlank()) return
        alertArmed = false
        if (manager.areNotificationsEnabled()) {
            manager.notify(1, Notification.Builder(this, alertChannel)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setAutoCancel(true)
                .setContentIntent(android.app.PendingIntent.getActivity(
                    this, 0, Intent(this, MainActivity::class.java),
                    android.app.PendingIntent.FLAG_IMMUTABLE
                ))
                .build())
        }
    }

    private fun completeAlertOptIn(reply: JavaScriptReplyProxy) {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(
            NotificationChannel(alertChannel, "Ride arrival alerts", NotificationManager.IMPORTANCE_HIGH)
        )
        alertArmed = manager?.areNotificationsEnabled() == true &&
            manager.getNotificationChannel(alertChannel)?.importance != NotificationManager.IMPORTANCE_NONE
        reply.postMessage(if (alertArmed) "armed" else "blocked")
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grants: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grants)
        if (requestCode == 41) {
            val reply = alertPermissionReply ?: return
            alertPermissionReply = null
            completeAlertOptIn(reply)
        }
    }

    private fun pinStation(shortcuts: ShortcutManager, data: String) {
        if (data.length > 160) return
        val request = runCatching { JSONObject(data) }.getOrNull() ?: return
        val station = request.optString("station")
        val label = request.optString("label").trim()
        if (!stationCode.matches(station) || label.isEmpty() || label.length > 60) return
        val shortcut = ShortcutInfo.Builder(this, "station-$station")
            .setShortLabel(label)
            .setLongLabel("$label departures")
            .setIcon(Icon.createWithResource(this, R.drawable.ic_launcher))
            .setIntent(Intent(this, MainActivity::class.java).setAction(boardAction)
                .putExtra("station", station))
            .build()
        if (!shortcuts.requestPinShortcut(shortcut, null)) {
            Toast.makeText(this, "Your launcher couldn’t pin this station.", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openEntryPoint(intent)
    }

    private fun openEntryPoint(intent: Intent) {
        val url = if (intent.action == boardAction) {
            val station = intent.getStringExtra("station").orEmpty().takeIf(stationCode::matches).orEmpty()
            Uri.parse(launchUrl).buildUpon().appendQueryParameter("board", station).build().toString()
        } else launchUrl
        webView.loadUrl(url)
    }

    private fun isPreviewOrigin(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == host && (uri.port == -1 || uri.port == 443)

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
