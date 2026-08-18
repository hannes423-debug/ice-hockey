using System;
using Windows.Gaming.Input;
using Windows.System;
using Windows.System.Display;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Input;
using Windows.UI.Xaml.Navigation;

namespace IceHockeyXbox
{
    /// <summary>
    /// One WebView, pointed at the game, plus the two things a console needs
    /// that a desktop window does not: a screen that never dims during a
    /// twenty-minute period with no button presses, and a way to change what
    /// is loaded without a PC in the room.
    /// </summary>
    public sealed partial class MainPage : Page
    {
        private HostConfig _config;
        private readonly DisplayRequest _display = new DisplayRequest();
        private bool _displayHeld;

        /* Dev combo state. LB + RB + View, held — see PollGamepad. */
        private DispatcherTimer _padTimer;
        private DateTimeOffset _comboSince = DateTimeOffset.MaxValue;
        private bool _comboFired;
        private static readonly TimeSpan ComboHold = TimeSpan.FromMilliseconds(900);
        private const GamepadButtons DevCombo =
            GamepadButtons.LeftShoulder | GamepadButtons.RightShoulder | GamepadButtons.View;

        public MainPage()
        {
            InitializeComponent();

            Game.NavigationStarting += OnNavigationStarting;
            Game.NavigationCompleted += OnNavigationCompleted;
            Game.NewWindowRequested += OnNewWindowRequested;
            Game.UnsupportedUriSchemeIdentified += OnUnsupportedScheme;

            // F5 for the same reload as the pad combo, so the host can be
            // developed on a PC with a keyboard before it ever sees a console.
            KeyDown += OnKeyDown;
        }

        protected override async void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            _config = await HostConfig.LoadAsync();

            /* A hockey game can sit in a menu, or in a long replay, with no
             * input at all. Without this the console dims and then blanks
             * mid-session, exactly like a video app would want and a game
             * would not. Released again in OnNavigatedFrom. */
            if (!_displayHeld) { _display.RequestActive(); _displayHeld = true; }

            StartPadWatch();
            Load();
        }

        protected override void OnNavigatedFrom(NavigationEventArgs e)
        {
            base.OnNavigatedFrom(e);
            if (_displayHeld) { _display.RequestRelease(); _displayHeld = false; }
            _padTimer?.Stop();
        }

        // ---------------------------------------------------------------- load

        private void Load()
        {
            var uri = _config.ResolveUri();
            ShowStatus("loading " + _config.Mode.ToLowerInvariant(), uri.ToString());
            Game.Navigate(uri);
            // Take focus off XAML and give it to the page, so keyboard input
            // (and, on a PC, the on-screen keyboard) lands in the game.
            Game.Focus(FocusState.Programmatic);
        }

        private async void HardReload()
        {
            /* The reason a reload button exists at all: in REMOTE mode the
             * console is showing whatever GitHub Pages served it, and the
             * whole workflow is "push, then look at the TV". The query stamp
             * in HostConfig.ResolveUri gets the HTML; this also drops the
             * WebView's cached sub-resources, which is what you want after
             * changing style.css or script.js, whose names are not hashed. */
            try { await WebView.ClearTemporaryWebDataAsync(); }
            catch (Exception ex) { System.Diagnostics.Debug.WriteLine("[IceHockeyXbox] cache clear failed: " + ex.Message); }
            Load();
        }

        // -------------------------------------------------------- webview wiring

        private void OnNavigationStarting(WebView sender, WebViewNavigationStartingEventArgs args)
        {
            System.Diagnostics.Debug.WriteLine("[IceHockeyXbox] -> " + args.Uri);
        }

        private void OnNavigationCompleted(WebView sender, WebViewNavigationCompletedEventArgs args)
        {
            if (args.IsSuccess)
            {
                HideStatus();
                Game.Focus(FocusState.Programmatic);
                return;
            }

            /* The failure this will actually hit, over and over, is a REMOTE
             * load with no network yet (the console reconnects to Wi-Fi
             * noticeably later than an app can launch) — so say which URL and
             * which mode, and say the combo that switches to the bundled copy.
             * A blank screen with no explanation is the thing to never ship to
             * a device with no developer console attached. */
            ShowStatus(
                "could not load — " + args.WebErrorStatus,
                args.Uri != null ? args.Uri.ToString() : _config.ResolveUri().ToString());
        }

        private async void OnNewWindowRequested(WebView sender, WebViewNewWindowRequestedEventArgs args)
        {
            // Nothing in the game opens a window; if anything ever does, it
            // goes to the console's browser rather than replacing the game.
            args.Handled = true;
            if (args.Uri != null) await Launcher.LaunchUriAsync(args.Uri);
        }

        private async void OnUnsupportedScheme(WebView sender, WebViewUnsupportedUriSchemeIdentifiedEventArgs args)
        {
            args.Handled = true;
            if (args.Uri != null) await Launcher.LaunchUriAsync(args.Uri);
        }

        // ------------------------------------------------------------ dev input

        private void OnKeyDown(object sender, KeyRoutedEventArgs e)
        {
            // A key can arrive before OnNavigatedTo's await has come back.
            if (_config == null) return;
            if (e.Key == VirtualKey.F5) { e.Handled = true; HardReload(); }
            else if (e.Key == VirtualKey.F6) { e.Handled = true; ToggleMode(); }
        }

        private void StartPadWatch()
        {
            _padTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(120) };
            _padTimer.Tick += (s, e) => PollGamepad();
            _padTimer.Start();
        }

        /// <summary>
        /// The console's only developer control: hold LB + RB + View for about
        /// a second to switch REMOTE&lt;-&gt;LOCAL and reload.
        ///
        /// Polled here in C# rather than handled in the page because it has to
        /// work when the page is the thing that is broken — a REMOTE build that
        /// throws on load cannot offer you a button to escape itself.
        ///
        /// Reading the pad here does NOT take it from the game: Windows.Gaming.Input
        /// and the WebView's Gamepad API are both readers of the same state.
        /// The combo is three buttons and a hold precisely so it cannot be hit
        /// during play; LB+RB together are a defensive-stick modifier in this
        /// game, but View is not part of any of its combos.
        /// </summary>
        private void PollGamepad()
        {
            if (_config == null) return;   // config not loaded yet

            GamepadButtons pressed = GamepadButtons.None;
            try
            {
                var pads = Gamepad.Gamepads;
                for (int i = 0; i < pads.Count; i++) pressed |= pads[i].GetCurrentReading().Buttons;
            }
            catch (Exception) { return; }   // pad list mutating under us; try again next tick

            bool held = (pressed & DevCombo) == DevCombo;

            if (!held) { _comboSince = DateTimeOffset.MaxValue; _comboFired = false; return; }
            if (_comboFired) return;
            if (_comboSince == DateTimeOffset.MaxValue) { _comboSince = DateTimeOffset.UtcNow; return; }
            if (DateTimeOffset.UtcNow - _comboSince < ComboHold) return;

            _comboFired = true;
            ToggleMode();
        }

        private void ToggleMode()
        {
            _config.ToggleMode();
            HardReload();
        }

        // ---------------------------------------------------------------- status

        private void ShowStatus(string line, string detail)
        {
            StatusLine.Text = line + "\n" + detail;
            StatusHint.Text =
                "mode " + _config.Mode + "  ·  config from " + _config.Source + "\n" +
                "hold LB + RB + View to switch between the live web build and the bundled copy";
            Status.Visibility = Visibility.Visible;
        }

        private void HideStatus() => Status.Visibility = Visibility.Collapsed;
    }
}
