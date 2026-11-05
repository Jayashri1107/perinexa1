package com.perinexa.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;
import java.io.OutputStream;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String COULD_NOT_SAVE = "The file could not be saved. Please try again.";

    // The file waiting for the person to choose where to save it. It is held only in memory, never kept on the phone.
    private String waitingFile;

    private final ActivityResultLauncher<Intent> chooseWhereToSave = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        this::saveWaitingFile
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView web = getBridge().getWebView();

        // The website calls these where a browser would print or download (client/src/platform/androidApp.js)
        web.addJavascriptInterface(new WebsiteCalls(), "PerinexaApp");

        // A link to a file the page cannot show (a scan or a lab report as a PDF): fetched with the person's own
        // sign-in and saved like any other file
        web.setDownloadListener((url, userAgent, disposition, type, length) -> {
            if (!onOwnSite() || !isOwnSite(url)) return;
            String name = JSONObject.quote(URLUtil.guessFileName(url, disposition, type));
            web.evaluateJavascript(
                "fetch(" + JSONObject.quote(url) + ",{credentials:'include'})" +
                ".then(r=>{if(!r.ok)throw new Error();return r.blob()})" +
                ".then(b=>{const f=new FileReader();f.onload=()=>PerinexaApp.saveFile(String(f.result).split(',')[1]||''," + name + ",b.type);f.readAsDataURL(b)})" +
                ".catch(()=>PerinexaApp.fileFailed())",
                null
            );
        });

        // Back goes to the previous screen; on the first screen it leaves the app
        getOnBackPressedDispatcher().addCallback(
            this,
            new OnBackPressedCallback(true) {
                @Override
                public void handleOnBackPressed() {
                    if (web.canGoBack()) {
                        web.goBack();
                        return;
                    }
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        );
    }

    private boolean isOwnSite(String address) {
        if (address == null) return false;
        String host = Uri.parse(address).getHost();
        return host != null && host.equals(Uri.parse(getBridge().getConfig().getServerUrl()).getHost());
    }

    /** Only Perinexa's own site may print or save, not a page it was sent to by mistake. */
    private boolean onOwnSite() {
        return isOwnSite(getBridge().getWebView().getUrl());
    }

    private void saveWaitingFile(ActivityResult result) {
        String file = waitingFile;
        waitingFile = null;
        Uri place = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != RESULT_OK || place == null || file == null) return; // the person cancelled
        new Thread(() -> {
            boolean saved = false;
            try (OutputStream out = getContentResolver().openOutputStream(place)) {
                if (out != null) {
                    out.write(Base64.decode(file, Base64.DEFAULT));
                    saved = true;
                }
            } catch (Exception ignored) {
                // said below
            }
            String words = saved ? "File saved" : COULD_NOT_SAVE;
            runOnUiThread(() -> Toast.makeText(this, words, Toast.LENGTH_LONG).show());
        }).start();
    }

    private class WebsiteCalls {

        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                if (!onOwnSite()) return;
                String name = title == null || title.isEmpty() ? "Perinexa" : title;
                PrintManager printer = getSystemService(PrintManager.class);
                printer.print(name, getBridge().getWebView().createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
            });
        }

        @JavascriptInterface
        public void saveFile(String base64, String fileName, String type) {
            runOnUiThread(() -> {
                if (!onOwnSite()) return;
                waitingFile = base64;
                String plainType = type == null ? "" : type.split(";")[0].trim();
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(plainType.isEmpty() ? "application/octet-stream" : plainType)
                    .putExtra(Intent.EXTRA_TITLE, fileName);
                chooseWhereToSave.launch(intent);
            });
        }

        @JavascriptInterface
        public void fileFailed() {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, COULD_NOT_SAVE, Toast.LENGTH_LONG).show());
        }
    }
}
