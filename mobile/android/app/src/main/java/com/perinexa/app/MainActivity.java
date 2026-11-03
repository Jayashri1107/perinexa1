package com.perinexa.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;

/**
 * The app opens the website. What a browser does by itself and a phone app's web view does not is added here
 * (no extra packages): the Back button goes back a page, Print opens the phone's print screen, and a PDF or Excel
 * file goes to the phone's share screen. A shared file is kept only in the app's cache and is removed the next
 * time the app starts: no patient data stays on the phone.
 */
public class MainActivity extends BridgeActivity {
    private static final String SHARE_FOLDER = "shared";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        clearSharedFiles();
        WebView web = getBridge().getWebView();
        web.addJavascriptInterface(new PhoneFeatures(web), "PerinexaApp");
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) {
                    web.goBack();
                } else {
                    moveTaskToBack(true);
                }
            }
        });
    }

    private File sharedFolder() {
        return new File(getCacheDir(), SHARE_FOLDER);
    }

    private void clearSharedFiles() {
        File[] files = sharedFolder().listFiles();
        if (files == null) return;
        for (File f : files) f.delete();
    }

    /** Called by the website: window.PerinexaApp (client/src/components/print). */
    private class PhoneFeatures {
        private final WebView web;

        PhoneFeatures(WebView web) {
            this.web = web;
        }

        @JavascriptInterface
        public void print(String title) {
            runOnUiThread(() -> {
                PrintManager printer = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                String name = title == null || title.isEmpty() ? "Perinexa" : title;
                printer.print(name, web.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
            });
        }

        @JavascriptInterface
        public void shareFile(String fileName, String mimeType, String base64) {
            try {
                File folder = sharedFolder();
                folder.mkdirs();
                // Only the file's own name: never a path from the page
                File file = new File(folder, new File(fileName).getName());
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(Base64.decode(base64, Base64.DEFAULT));
                }
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mimeType);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, file.getName())));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "The file could not be opened.", Toast.LENGTH_LONG).show());
            }
        }
    }
}
