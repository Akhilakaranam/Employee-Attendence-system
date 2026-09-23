package com.attendly.employee;

import android.os.Handler;
import android.os.Looper;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ApiClient {
    public interface Callback { void done(JSONObject data, String error); }
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final String BASE_URL = "http://10.0.2.2:5000";
    private static String token;

    public static void setToken(String value) { token = value; }
    public static void request(String path, String method, JSONObject body, Callback callback) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(BASE_URL + path).openConnection();
                connection.setRequestMethod(method); connection.setConnectTimeout(7000); connection.setReadTimeout(7000);
                connection.setRequestProperty("Content-Type", "application/json");
                if (token != null) connection.setRequestProperty("Authorization", "Bearer " + token);
                if (body != null) { connection.setDoOutput(true); try (OutputStream output = connection.getOutputStream()) { output.write(body.toString().getBytes()); } }
                int code = connection.getResponseCode();
                BufferedReader reader = new BufferedReader(new InputStreamReader(code >= 400 ? connection.getErrorStream() : connection.getInputStream()));
                StringBuilder text = new StringBuilder(); String line; while ((line = reader.readLine()) != null) text.append(line);
                JSONObject data = new JSONObject(text.toString());
                finish(callback, data, code >= 400 ? data.optString("message", "Request failed") : null);
            } catch (Exception error) { finish(callback, null, error.getMessage()); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    private static void finish(Callback callback, JSONObject data, String error) { MAIN.post(() -> callback.done(data, error)); }
}
