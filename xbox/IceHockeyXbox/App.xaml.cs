using System;
using Windows.ApplicationModel;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace IceHockeyXbox
{
    /// <summary>
    /// The Xbox host application. It is a WINDOW, exactly like electron/main.js
    /// is a window: it contains no gameplay logic, no asset paths and no
    /// knowledge of how the game works. It opens one WebView on the game and
    /// gets out of the way.
    ///
    /// The two Xbox-specific decisions both live here, and both are about
    /// giving the WebView the whole console instead of a well-behaved app's
    /// share of it. See the comments on each.
    /// </summary>
    sealed partial class App : Application
    {
        public App()
        {
            InitializeComponent();

            /* THE SINGLE MOST IMPORTANT LINE FOR CONTROLLER SUPPORT.
             *
             * By default a UWP app on Xbox runs in "mouse mode": the left stick
             * drives an on-screen cursor that XAML owns, and the D-pad drives
             * XY-focus navigation between XAML elements. Both consume the pad
             * before the page ever sees it, so the game reads a stick that
             * never moves while a cursor slides around on top of it.
             *
             * WhenRequested turns that off unless a page explicitly asks for
             * it. Nothing here asks. The pad then belongs to the page, and the
             * game's existing browser Gamepad API code — navigator.getGamepads()
             * polled every frame, already handling `mapping !== "standard"` —
             * works with no Xbox-specific input path at all.
             */
            RequiresPointerMode = ApplicationRequiresPointerMode.WhenRequested;

            Suspending += OnSuspending;
            UnhandledException += (s, e) =>
            {
                // A host crash on a console shows as an instant silent exit.
                // At least leave it in the debugger's output window.
                System.Diagnostics.Debug.WriteLine("[IceHockeyXbox] unhandled: " + e.Exception);
            };
        }

        protected override void OnLaunched(LaunchActivatedEventArgs e)
        {
            /* Xbox draws UWP apps inside a TV "safe area" by default, so the
             * page would sit in a letterbox with a border of console-coloured
             * nothing around it. UseCoreWindow claims the full panel; the game
             * already handles its own overscan-safe layout on a phone in
             * fullscreen, and a black border on a modern TV is not a hazard. */
            try
            {
                var view = Windows.UI.ViewManagement.ApplicationView.GetForCurrentView();
                view.SetDesiredBoundsMode(Windows.UI.ViewManagement.ApplicationViewBoundsMode.UseCoreWindow);
            }
            catch (Exception) { /* not Xbox, or already set — harmless */ }

            /* And Xbox scales UWP layout 2x, so a 3840x2160 or 1920x1080 panel
             * reports itself to CSS as half that. For a XAML app that is
             * correct — text on a TV is read from three metres away. For a
             * three.js canvas it is a straight halving of the render
             * resolution the game never asked for. Opt out and take real
             * pixels; the game's own UI is already sized for a phone held at
             * arm's length, which is close enough to a TV across a room. */
            try
            {
                Windows.UI.ViewManagement.ApplicationViewScaling.TrySetDisableLayoutScaling(true);
            }
            catch (Exception) { /* API is Xbox-only; ignore elsewhere */ }

            var root = Window.Current.Content as Frame;
            if (root == null)
            {
                root = new Frame();
                root.NavigationFailed += OnNavigationFailed;
                Window.Current.Content = root;
            }

            if (e.PrelaunchActivated == false && root.Content == null)
                root.Navigate(typeof(MainPage), e.Arguments);

            Window.Current.Activate();
        }

        void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            throw new Exception("Failed to load Page " + e.SourcePageType.FullName);
        }

        void OnSuspending(object sender, SuspendingEventArgs e)
        {
            // Nothing to save. The game keeps its own state in localStorage,
            // which the WebView persists for us.
            var deferral = e.SuspendingOperation.GetDeferral();
            deferral.Complete();
        }
    }
}
