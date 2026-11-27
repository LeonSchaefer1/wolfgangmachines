package de.wolfgang.tueftelwerkstatt;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Fullscreen landscape WebView wrapper around the web game in assets/www/.
 *
 * The game is served from https://appassets.androidplatform.net/ (a virtual,
 * offline origin provided by WebViewAssetLoader) so that ES modules, fetch()
 * and localStorage behave exactly like on a real https origin.
 *
 * Hooks the web game may define (all optional):
 *   window.onAndroidBack()  -> return true if the back press was handled
 *   window.onAppPause()     -> app goes to background
 *   window.onAppResume()    -> app comes back to foreground
 * Bridge offered to the game:
 *   AndroidBridge.vibrate(ms), AndroidBridge.getAppVersion()
 */
public class MainActivity extends Activity {

    private static final String TAG = "Tueftelwerkstatt";
    private static final String ASSET_HOST = WebViewAssetLoader.DEFAULT_DOMAIN; // appassets.androidplatform.net
    private static final String START_URL = "https://" + ASSET_HOST + "/index.html";
    private static final String ASSET_DIR = "www";

    private WebView webView;
    private boolean pageReady = false;
    private OnBackInvokedCallback backCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        window.setBackgroundDrawableResource(android.R.color.black);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = window.getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(lp);
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.BLACK);
        configureWebView(webView);
        setContentView(webView);

        applyImmersiveMode();
        registerBackHandler();

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
            if (webView.getUrl() == null) {
                webView.loadUrl(START_URL);
            }
        }
    }

    // ------------------------------------------------------------------ WebView

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    private void configureWebView(WebView wv) {
        WebSettings s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage (persists in the app's data dir)
        s.setDatabaseEnabled(true);            // IndexedDB/WebSQL, in case the game wants it
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                    // ignore the system font-size setting; the game scales itself
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }

        // Rendering stays on the default hardware layer (needed for WebGL).
        wv.setOverScrollMode(View.OVER_SCROLL_NEVER);
        wv.setVerticalScrollBarEnabled(false);
        wv.setHorizontalScrollBarEnabled(false);
        wv.setScrollbarFadingEnabled(true);
        wv.setHapticFeedbackEnabled(false);
        wv.setFocusable(true);
        wv.setFocusableInTouchMode(true);

        // Keep the renderer process at foreground priority while the app is visible.
        wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);

        // No long-press context menu / text selection.
        wv.setLongClickable(false);
        wv.setOnLongClickListener(v -> true);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(ASSET_HOST)
                .setHttpAllowed(false)
                .addPathHandler("/", new WwwPathHandler(this))
                .build();

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                WebResourceResponse r = assetLoader.shouldInterceptRequest(url);
                if (r != null) {
                    return r;
                }
                // Offline app: everything that is not a bundled asset gets an empty 404
                // instead of a network attempt.
                if (!"data".equals(url.getScheme()) && !"blob".equals(url.getScheme())) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            new HashMap<>(), new java.io.ByteArrayInputStream(new byte[0]));
                }
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Never leave the bundled game.
                return !ASSET_HOST.equals(request.getUrl().getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                pushCutoutInsets();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // The WebView renderer died (e.g. out of memory). Restart the
                // activity instead of letting the whole app crash.
                Log.e(TAG, "WebView render process gone (crashed=" + detail.didCrash() + "), recreating");
                pageReady = false;
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) {
                    parent.removeView(view);
                }
                view.destroy();
                webView = null;
                recreate();
                return true;
            }
        });

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                String line = "[" + m.messageLevel() + "] " + m.message()
                        + "  (" + shortSource(m.sourceId()) + ":" + m.lineNumber() + ")";
                switch (m.messageLevel()) {
                    case ERROR:   Log.e(TAG, line); break;
                    case WARNING: Log.w(TAG, line); break;
                    default:      Log.i(TAG, line); break;
                }
                return true;
            }
        });

        wv.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");

        // Tell the game where the camera cut-out is whenever the insets change (rotation by 180 degrees).
        wv.setOnApplyWindowInsetsListener((v, insets) -> {
            v.post(this::pushCutoutInsets);
            return v.onApplyWindowInsets(insets);
        });
    }

    /**
     * Reports the display cut-out (punch-hole camera) to the game in CSS pixels:
     * window.__setInsets(left, right). The game keeps its controls out of that strip.
     * This is a fallback for WebViews that do not expose env(safe-area-inset-*).
     */
    private void pushCutoutInsets() {
        if (webView == null || !pageReady || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return;
        }
        WindowInsets wi = webView.getRootWindowInsets();
        DisplayCutout cutout = wi != null ? wi.getDisplayCutout() : null;
        float density = getResources().getDisplayMetrics().density;
        float left = cutout != null ? cutout.getSafeInsetLeft() / density : 0f;
        float right = cutout != null ? cutout.getSafeInsetRight() / density : 0f;
        webView.evaluateJavascript(String.format(Locale.ROOT,
                "(function(){if(typeof window.__setInsets==='function'){window.__setInsets(%.1f,%.1f);}})()",
                left, right), null);
    }

    private static String shortSource(String src) {
        if (src == null) return "";
        int i = src.lastIndexOf('/');
        return i >= 0 ? src.substring(i + 1) : src;
    }

    /** Serves https://appassets.androidplatform.net/<path> from assets/www/<path>. */
    private static final class WwwPathHandler implements WebViewAssetLoader.PathHandler {
        private static final Map<String, String> MIME = new HashMap<>();
        static {
            MIME.put("html", "text/html");
            MIME.put("htm", "text/html");
            MIME.put("js", "text/javascript");
            MIME.put("mjs", "text/javascript");
            MIME.put("css", "text/css");
            MIME.put("json", "application/json");
            MIME.put("map", "application/json");
            MIME.put("webmanifest", "application/manifest+json");
            MIME.put("txt", "text/plain");
            MIME.put("xml", "application/xml");
            MIME.put("svg", "image/svg+xml");
            MIME.put("png", "image/png");
            MIME.put("jpg", "image/jpeg");
            MIME.put("jpeg", "image/jpeg");
            MIME.put("gif", "image/gif");
            MIME.put("webp", "image/webp");
            MIME.put("ico", "image/x-icon");
            MIME.put("ogg", "audio/ogg");
            MIME.put("oga", "audio/ogg");
            MIME.put("opus", "audio/ogg");
            MIME.put("mp3", "audio/mpeg");
            MIME.put("m4a", "audio/mp4");
            MIME.put("wav", "audio/wav");
            MIME.put("webm", "video/webm");
            MIME.put("mp4", "video/mp4");
            MIME.put("woff", "font/woff");
            MIME.put("woff2", "font/woff2");
            MIME.put("ttf", "font/ttf");
            MIME.put("otf", "font/otf");
            MIME.put("wasm", "application/wasm");
            MIME.put("glb", "model/gltf-binary");
            MIME.put("gltf", "model/gltf+json");
            MIME.put("bin", "application/octet-stream");
            MIME.put("ktx2", "image/ktx2");
            MIME.put("hdr", "application/octet-stream");
        }

        private final Context context;

        WwwPathHandler(Context context) {
            this.context = context.getApplicationContext();
        }

        @Override
        public WebResourceResponse handle(String path) {
            if (path.isEmpty() || path.endsWith("/")) {
                path = path + "index.html";
            }
            if (path.contains("..")) {
                return notFound();
            }
            String mime = mimeOf(path);
            try {
                InputStream in = context.getAssets().open(ASSET_DIR + "/" + path);
                boolean text = mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("xml");
                WebResourceResponse r = new WebResourceResponse(mime, text ? "utf-8" : null, in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-cache");
                headers.put("Access-Control-Allow-Origin", "*");
                r.setResponseHeaders(headers);
                return r;
            } catch (IOException e) {
                Log.w(TAG, "asset not found: " + path);
                return notFound();
            }
        }

        private static WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<>(), new java.io.ByteArrayInputStream(new byte[0]));
        }

        private static String mimeOf(String path) {
            int dot = path.lastIndexOf('.');
            if (dot >= 0) {
                String m = MIME.get(path.substring(dot + 1).toLowerCase(Locale.ROOT));
                if (m != null) return m;
            }
            return "application/octet-stream";
        }
    }

    // ------------------------------------------------------------- JS bridge

    private final class AndroidBridge {
        /** Short haptic tick. Called from JS: AndroidBridge.vibrate(20) */
        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                int duration = Math.max(1, Math.min(ms, 500));
                Vibrator vib;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                    vib = vm != null ? vm.getDefaultVibrator() : null;
                } else {
                    vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                }
                if (vib != null && vib.hasVibrator()) {
                    vib.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
                }
            } catch (RuntimeException e) {
                Log.w(TAG, "vibrate failed", e);
            }
        }

        /** The game calls this once it has started, to receive window.__setInsets(left, right). */
        @JavascriptInterface
        public void requestInsets() {
            runOnUiThread(MainActivity.this::pushCutoutInsets);
        }

        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME;
        }
    }

    /** Calls an optional global JS hook, e.g. window.onAppPause && window.onAppPause(). */
    private void callJsHook(String name) {
        if (webView != null && pageReady) {
            webView.evaluateJavascript(
                    "(function(){try{if(typeof window." + name + "==='function'){window." + name + "();}}"
                            + "catch(e){console.error('" + name + " failed: '+e);}})()", null);
        }
    }

    // ------------------------------------------------------------- lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            callJsHook("onAppResume");
        }
        applyImmersiveMode();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            // Hook first (so the game can save + mute), then pause the WebView
            // (fires visibilitychange, stops rAF/rendering).
            callJsHook("onAppPause");
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) {
            webView.saveState(outState);
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) {
                parent.removeView(webView);
            }
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------ fullscreen

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersiveMode();
        }
    }

    @SuppressWarnings("deprecation")
    private void applyImmersiveMode() {
        Window window = getWindow();
        View decor = window.getDecorView();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController c = window.getInsetsController();
            if (c != null) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
        } else {
            decor.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    // ----------------------------------------------------------- back button

    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    /** Android < 13 (on 13+ the OnBackInvokedCallback above is used instead). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    /**
     * Asks the game first: window.onAndroidBack() returning true means "handled"
     * (e.g. a dialog was closed). Otherwise the app goes to the background
     * (it is not destroyed, so the player continues where they left off).
     */
    private void handleBack() {
        if (webView == null || !pageReady) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.onAndroidBack && window.onAndroidBack());}"
                        + "catch(e){console.error('onAndroidBack failed: '+e);return false;}})()",
                value -> {
                    if (!"true".equals(value)) {
                        moveTaskToBack(true);
                    }
                });
    }
}
