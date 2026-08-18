using System;
using Windows.Data.Json;
using Windows.Storage;

namespace IceHockeyXbox
{
    /// <summary>
    /// Where the host gets its one decision from: REMOTE (GitHub Pages or a LAN
    /// dev server) or LOCAL (the copy bundled in the package).
    ///
    /// Two layers, in this order:
    ///
    ///   1. ms-appx:///config.json   — ships in the package, the committed default
    ///   2. LocalState\config.json   — optional, overrides 1
    ///
    /// Layer 2 is the point of the whole class. Xbox Device Portal has a file
    /// browser into LocalState, so switching the console between the live web
    /// build and the packaged copy is editing one file over the network — no
    /// Visual Studio, no redeploy, no rebuild. That is also why parsing is
    /// forgiving: a malformed override must fall back to the packaged default
    /// and say so, never leave the console on a black screen.
    ///
    /// Deliberately NOT a settings system. Two fields and a URL.
    /// </summary>
    public sealed class HostConfig
    {
        public const string Remote = "REMOTE";
        public const string Local = "LOCAL";

        public string Mode { get; private set; } = Remote;
        public string RemoteUrl { get; private set; } = "https://hannes423-debug.github.io/ice-hockey/";
        public string LocalUrl { get; private set; } = "ms-appx-web:///GameLocal/index.html";
        public bool CacheBust { get; private set; } = true;

        /// <summary>Where the override was read from, for the on-screen boot line.</summary>
        public string Source { get; private set; } = "built-in defaults";

        public bool IsRemote => string.Equals(Mode, Remote, StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// The URL to hand the WebView. In REMOTE the launch timestamp is
        /// appended so a push made a minute ago is actually what loads: the
        /// EdgeHTML WebView will otherwise serve GitHub Pages' cached HTML for
        /// as long as its max-age says. Sub-resources still come from cache,
        /// which is wanted — three.js and the fonts have hashed names and never
        /// change silently. Only the page itself is forced fresh.
        /// </summary>
        public Uri ResolveUri()
        {
            if (!IsRemote) return new Uri(LocalUrl);

            var url = RemoteUrl;
            if (CacheBust)
            {
                var stamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
                url += (url.IndexOf('?') >= 0 ? "&" : "?") + "ih=" + stamp;
            }
            return new Uri(url);
        }

        /// <summary>Flip REMOTE&lt;-&gt;LOCAL for this run only. The dev combo uses it.</summary>
        public void ToggleMode() => Mode = IsRemote ? Local : Remote;

        public static async System.Threading.Tasks.Task<HostConfig> LoadAsync()
        {
            var cfg = new HostConfig();

            // 1. the packaged default
            try
            {
                var packaged = await StorageFile.GetFileFromApplicationUriAsync(
                    new Uri("ms-appx:///config.json"));
                if (cfg.Apply(await FileIO.ReadTextAsync(packaged))) cfg.Source = "package config.json";
            }
            catch (Exception ex)
            {
                cfg.Source = "built-in defaults (package config.json unreadable: " + ex.Message + ")";
            }

            // 2. the LocalState override, if someone dropped one there
            try
            {
                var item = await ApplicationData.Current.LocalFolder.TryGetItemAsync("config.json");
                if (item is StorageFile local && cfg.Apply(await FileIO.ReadTextAsync(local)))
                    cfg.Source = "LocalState config.json";
            }
            catch (Exception ex)
            {
                cfg.Source += " (LocalState override ignored: " + ex.Message + ")";
            }

            return cfg;
        }

        /// <summary>
        /// Merge one JSON document in. Every field is optional and every bad
        /// value is skipped rather than thrown on, so a half-written override
        /// degrades to the layer beneath it instead of bricking the launch.
        /// </summary>
        private bool Apply(string json)
        {
            JsonObject o;
            if (!JsonObject.TryParse(json, out o)) return false;

            var mode = Str(o, "mode");
            if (string.Equals(mode, Remote, StringComparison.OrdinalIgnoreCase)) Mode = Remote;
            else if (string.Equals(mode, Local, StringComparison.OrdinalIgnoreCase)) Mode = Local;

            var remote = Str(o, "remoteUrl");
            if (!string.IsNullOrWhiteSpace(remote) && Uri.IsWellFormedUriString(remote, UriKind.Absolute))
                RemoteUrl = remote;

            var local = Str(o, "localUrl");
            if (!string.IsNullOrWhiteSpace(local) && Uri.IsWellFormedUriString(local, UriKind.Absolute))
                LocalUrl = local;

            if (o.ContainsKey("cacheBust") && o["cacheBust"].ValueType == JsonValueType.Boolean)
                CacheBust = o.GetNamedBoolean("cacheBust");

            return true;
        }

        private static string Str(JsonObject o, string key)
        {
            if (!o.ContainsKey(key)) return null;
            return o[key].ValueType == JsonValueType.String ? o.GetNamedString(key) : null;
        }
    }
}
