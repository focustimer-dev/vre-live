package work.samelling.vrelive.lab

import android.app.Activity
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
import androidx.webkit.WebViewAssetLoader

/**
 * Packaged VRE interface with a same-origin preview API.
 * No native notifications, credentials, bridge or background services yet.
 */
class MainActivity : Activity() {
    private val host = "vre-live-lab-preview.samelling.workers.dev"
    private val assetPath = "/__vre_android__/"
    private val launchUrl = "https://$host${assetPath}app/index.html"
    private val feedPaths = setOf(
        "/feed/history", "/feed/TripUpdateFeed", "/feed/VehiclePositionFeed", "/feed/AlertFeed"
    )
    private lateinit var webView: WebView
    private lateinit var errorPanel: LinearLayout
    private var mainFrameFailed = false

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
            webView.loadUrl(launchUrl)
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
        webView.loadUrl(launchUrl)
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
