// The Windows desktop pet window.
//
// Deliberately mirrors desktop/web/index.html and main.swift:
//   * ui.json / activity.json are polled every 350 ms
//   * the atlas animates as CSS steps(frames) does (one frame per timer tick)
//   * bubbles use the same copy rules, lifetime and "+N" collapse behaviour
//   * dragging is cursor-polled so it keeps working while WPF is busy
//
// The window itself is a layered WPF window: transparent, borderless,
// always-on-top, absent from the taskbar and Alt+Tab, and optionally
// click-through (WS_EX_TRANSPARENT).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace PetPal
{
    internal sealed class PetPalWindow : Window
    {
        private readonly string _petsRoot;
        private readonly string _configDir;
        private readonly int _parentPid;

        private readonly Border _root;
        private readonly StackPanel _content;
        private readonly StackPanel _bubblePanel;
        private readonly TextBlock _collapse;
        private readonly Grid _stage;
        private readonly Image _sprite;

        private readonly DispatcherTimer _pollTimer = new DispatcherTimer();
        private readonly DispatcherTimer _frameTimer = new DispatcherTimer();
        private readonly DispatcherTimer _idleTimer = new DispatcherTimer();
        private readonly DispatcherTimer _dragTimer = new DispatcherTimer();
        private readonly DispatcherTimer _waveTimer = new DispatcherTimer();
        private readonly DispatcherTimer _parentTimer = new DispatcherTimer();

        private readonly Dictionary<string, BubbleView> _bubbleViews =
            new Dictionary<string, BubbleView>(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _hidden = new Dictionary<string, long>(StringComparer.Ordinal);
        private readonly Dictionary<string, long> _lastRev = new Dictionary<string, long>(StringComparer.Ordinal);
        private readonly Dictionary<string, bool> _holdState = new Dictionary<string, bool>(StringComparer.Ordinal);
        private readonly Dictionary<string, DateTime> _hideAt = new Dictionary<string, DateTime>(StringComparer.Ordinal);

        private UiConfig _ui = new UiConfig();
        private ActivityInfo _activity = new ActivityInfo();

        private SpriteSheet _sheet;
        private string _spritePath;
        private DateTime _spriteStamp = DateTime.MinValue;
        private long _spriteLength;

        private string _currentPose = "idle";
        private bool _currentHold = true;
        private int _frameIndex;
        private long _lastSeq = -1;
        private DateTime _lastActivityAt = DateTime.UtcNow;
        private DateTime _waveUntil = DateTime.MinValue;
        private bool _expanded;
        private string _structureKey = string.Empty;
        private bool _bubbleAppearanceDirty = true;

        private bool _loaded;
        private bool _initialized;
        private bool _positionApplied;
        private bool _exiting;
        private IntPtr _hwnd = IntPtr.Zero;

        private bool _dragging;
        private bool _dragMoved;
        private DateTime _dragStarted;
        private Native.POINT _dragStartCursor;
        private double _dragStartLeft;
        private double _dragStartTop;
        private double _dragScaleX = 1;
        private double _dragScaleY = 1;
        private string _dragDirection;

        private bool _pendingHasPosition;
        private double _pendingLeft;
        private double _pendingTop;
        private bool _collapsePressed;

        public PetPalWindow(string petsRoot, string configDir, int parentPid)
        {
            _petsRoot = petsRoot;
            _configDir = configDir;
            _parentPid = parentPid;

            Title = "PetPal";
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            ResizeMode = ResizeMode.NoResize;
            ShowInTaskbar = false;
            ShowActivated = false;
            Topmost = true;
            WindowStartupLocation = WindowStartupLocation.Manual;
            SizeToContent = SizeToContent.Manual;
            UseLayoutRounding = true;
            SnapsToDevicePixels = true;
            Width = 320;
            Height = 360;
            Left = 0;
            Top = 0;
            Opacity = 0;

            _root = new Border
            {
                Background = Brushes.Transparent,
                Padding = new Thickness(3, 2, 3, 0),
            };
            TextElement.SetFontFamily(_root, SystemFonts.MessageFontFamily);
            TextElement.SetFontSize(_root, 13);

            _content = new StackPanel
            {
                Orientation = Orientation.Vertical,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
            };

            _bubblePanel = new StackPanel
            {
                Orientation = Orientation.Vertical,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 6),
            };
            _bubblePanel.Opacity = 1;

            _collapse = new TextBlock
            {
                Text = "收起",
                FontSize = 10.5,
                Foreground = Brushes.White,
                Opacity = 0.7,
                Padding = new Thickness(8, 2, 8, 2),
                Cursor = Cursors.Hand,
                HorizontalAlignment = HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 6),
                Visibility = Visibility.Collapsed,
                Focusable = false,
            };
            _collapse.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e)
            {
                _collapsePressed = true;
                e.Handled = true;
            };
            _collapse.MouseLeave += delegate(object sender, MouseEventArgs e)
            {
                _collapsePressed = false;
            };
            _collapse.MouseLeftButtonUp += delegate(object sender, MouseButtonEventArgs e)
            {
                e.Handled = true;
                if (!_collapsePressed)
                {
                    return;
                }

                _collapsePressed = false;
                _expanded = false;
                RebuildBubbles();
            };

            _stage = new Grid
            {
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Bottom,
                ClipToBounds = true,
            };
            _sprite = new Image
            {
                Stretch = Stretch.Fill,
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                SnapsToDevicePixels = true,
            };
            RenderOptions.SetBitmapScalingMode(_sprite, BitmapScalingMode.HighQuality);
            _stage.Children.Add(_sprite);

            _content.Children.Add(_bubblePanel);
            _content.Children.Add(_collapse);
            _content.Children.Add(_stage);
            _root.Child = _content;
            Content = _root;

            TextOptions.SetTextFormattingMode(_root, TextFormattingMode.Display);
            TextOptions.SetTextRenderingMode(_root, TextRenderingMode.Grayscale);

            SourceInitialized += OnSourceInitialized;
            Loaded += OnLoaded;
            Closed += OnClosed;
            MouseLeftButtonDown += OnMouseLeftButtonDown;

            _pollTimer.Interval = TimeSpan.FromMilliseconds(350);
            _pollTimer.Tick += OnPollTick;
            _frameTimer.Tick += OnFrameTick;
            _idleTimer.Tick += OnIdleTick;
            _dragTimer.Interval = TimeSpan.FromMilliseconds(16);
            _dragTimer.Tick += OnDragTick;
            _waveTimer.Tick += OnWaveTick;
            _parentTimer.Interval = TimeSpan.FromSeconds(2);
            _parentTimer.Tick += OnParentTick;
        }

        // ------------------------------------------------------------------
        // Lifecycle

        private void OnSourceInitialized(object sender, EventArgs e)
        {
            _hwnd = new WindowInteropHelper(this).Handle;
            var source = HwndSource.FromHwnd(_hwnd);
            if (source != null)
            {
                source.AddHook(WndProc);
            }

            ApplyWindowStyle();
        }

        /// <summary>
        /// WS_EX_NOACTIVATE already tells DefWindowProc not to activate on
        /// click; answering WM_MOUSEACTIVATE explicitly keeps that true even if
        /// a future WPF version handles activation itself. The click itself is
        /// still delivered (MA_NOACTIVATE does not eat it).
        /// </summary>
        private IntPtr WndProc(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            const int WM_MOUSEACTIVATE = 0x0021;
            const int MA_NOACTIVATE = 3;
            if (message == WM_MOUSEACTIVATE)
            {
                handled = true;
                return new IntPtr(MA_NOACTIVATE);
            }

            return IntPtr.Zero;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            _loaded = true;
            Initialize();
        }

        private void OnClosed(object sender, EventArgs e)
        {
            _exiting = true;
            StopTimers();
            try
            {
                if (Application.Current != null)
                {
                    Application.Current.Shutdown();
                }
            }
            catch (Exception)
            {
            }
        }

        private void Initialize()
        {
            if (_initialized)
            {
                return;
            }

            _initialized = true;
            try
            {
                ReadUi(true);
                if (_exiting)
                {
                    return;
                }

                ReadActivity(true);
                if (_exiting)
                {
                    return;
                }

                ApplyBubbleStyle();
                RebuildBubbles();
                UpdatePose(true);
                Relayout();
                ApplyInitialPosition();
                _positionApplied = true;
                ApplyWindowStyle();
                Opacity = _ui.Visible ? 1.0 : 0.0;

                _pollTimer.Start();
                if (_parentPid > 1)
                {
                    _parentTimer.Start();
                }

                Log.Debug("ready; pets=" + _petsRoot);
            }
            catch (Exception exception)
            {
                Log.Error("initialize failed", exception);
                Exit();
            }
        }

        private void Exit()
        {
            if (_exiting)
            {
                return;
            }

            _exiting = true;
            StopTimers();
            try
            {
                Close();
            }
            catch (Exception)
            {
            }

            try
            {
                if (Application.Current != null)
                {
                    Application.Current.Shutdown();
                }
            }
            catch (Exception)
            {
            }
        }

        private void StopTimers()
        {
            _pollTimer.Stop();
            _frameTimer.Stop();
            _idleTimer.Stop();
            _dragTimer.Stop();
            _waveTimer.Stop();
            _parentTimer.Stop();
        }

        // ------------------------------------------------------------------
        // Files

        private void OnPollTick(object sender, EventArgs e)
        {
            if (_exiting)
            {
                return;
            }

            try
            {
                ReadUi(false);
                if (_exiting)
                {
                    return;
                }

                ReadActivity(false);
                if (_exiting)
                {
                    return;
                }

                RefreshSpriteIfChanged();

                // ReadActivity only applies the safety net when the file
                // changes; a stalled Host would otherwise leave a running pet
                // forever. Check the wall clock on every poll.
                if (ApplySafetyNet())
                {
                    UpdateHideSchedule();
                    RebuildBubbles();
                    UpdatePose(false);
                    Relayout();
                }

                if (ExpireHidden())
                {
                    RebuildBubbles();
                }
            }
            catch (Exception exception)
            {
                Log.Error("poll failed", exception);
            }
        }

        private string UiPath
        {
            get { return Path.Combine(_configDir, "ui.json"); }
        }

        private string ActivityPath
        {
            get { return Path.Combine(_configDir, "activity.json"); }
        }

        private void ReadUi(bool initial)
        {
            Dictionary<string, object> raw;
            if (!Json.TryReadObject(UiPath, out raw))
            {
                if (initial)
                {
                    _ui = new UiConfig();
                    ApplyBubbleStyle();
                    LoadSheet();
                }

                return;
            }

            var next = UiConfig.Parse(raw);
            if (initial)
            {
                _ui = next;
                if (!next.Enabled)
                {
                    Exit();
                    return;
                }

                if (next.HasPosition)
                {
                    _pendingHasPosition = true;
                    _pendingLeft = next.WinX;
                    _pendingTop = next.WinY;
                }

                ApplyBubbleStyle();
                LoadSheet();
                return;
            }

            if (!next.Enabled)
            {
                _ui = next;
                Exit();
                return;
            }

            var previous = _ui;
            _ui = next;
            ApplyUiChanges(previous);
        }

        private void ApplyUiChanges(UiConfig previous)
        {
            var activeChanged = !string.Equals(previous.Active, _ui.Active, StringComparison.Ordinal);
            var scaleChanged = Math.Abs(previous.Scale - _ui.Scale) > 0.0001;
            var appearanceChanged = !previous.SameBubbleAppearance(_ui);
            var visibilityChanged = previous.Visible != _ui.Visible ||
                                    previous.ClickThrough != _ui.ClickThrough;

            if (activeChanged)
            {
                LoadSheet();
                UpdatePose(true);
            }

            if (scaleChanged)
            {
                UpdateStageSize();
            }

            if (appearanceChanged)
            {
                _bubbleAppearanceDirty = true;
                ResetHideSchedule();
                ApplyBubbleStyle();
                RebuildBubbles();
            }

            if (visibilityChanged)
            {
                Opacity = _ui.Visible ? 1.0 : 0.0;
                ApplyWindowStyle();
            }

            if (activeChanged || scaleChanged || appearanceChanged)
            {
                Relayout();
            }
        }

        private void ReadActivity(bool initial)
        {
            Dictionary<string, object> raw;
            if (!Json.TryReadObject(ActivityPath, out raw))
            {
                if (initial)
                {
                    _activity = new ActivityInfo();
                    _lastSeq = -1;
                }

                return;
            }

            var next = ActivityInfo.Parse(raw);
            if (!initial && next.Seq == _lastSeq)
            {
                return;
            }

            _lastSeq = next.Seq;
            _activity = next;
            _lastActivityAt = DateTime.UtcNow;
            ApplySafetyNet();
            UpdateHideSchedule();
            if (_activity.Sessions.Count <= 1)
            {
                _expanded = false;
            }

            RebuildBubbles();
            UpdatePose(false);
            Relayout();
        }

        /// <summary>A missed terminal event must not leave the pet running forever.</summary>
        private bool ApplySafetyNet()
        {
            var now = DateTime.UtcNow;
            var changed = false;
            foreach (var session in _activity.Sessions)
            {
                if (!session.Hold || session.Status == "waiting")
                {
                    continue;
                }

                var limit = session.Status == "tool" ? 120 : 45;
                if ((now - _lastActivityAt).TotalSeconds <= limit)
                {
                    continue;
                }

                session.Hold = false;
                session.State = "idle";
                session.Status = null;
                session.Label = null;
                session.Detail = null;
                changed = true;
            }

            return changed;
        }

        private void UpdateHideSchedule()
        {
            if (_ui.BubbleLifetime <= 0)
            {
                _hideAt.Clear();
                return;
            }

            var now = DateTime.UtcNow;
            var live = new HashSet<string>(StringComparer.Ordinal);
            foreach (var session in _activity.Sessions)
            {
                live.Add(session.Id);

                long hiddenRev;
                if (_hidden.TryGetValue(session.Id, out hiddenRev) && hiddenRev != session.Rev)
                {
                    _hidden.Remove(session.Id);
                }

                if (session.Hold)
                {
                    _lastRev[session.Id] = session.Rev;
                    _holdState[session.Id] = true;
                    _hideAt.Remove(session.Id);
                    continue;
                }

                bool wasHold;
                _holdState.TryGetValue(session.Id, out wasHold);
                _holdState[session.Id] = false;

                long previousRev;
                if (!_lastRev.TryGetValue(session.Id, out previousRev) ||
                    previousRev != session.Rev ||
                    wasHold)
                {
                    _lastRev[session.Id] = session.Rev;
                    _hideAt[session.Id] = now.AddSeconds(_ui.BubbleLifetime);
                }
            }

            var stale = new List<string>();
            foreach (var id in _hideAt.Keys)
            {
                if (!live.Contains(id))
                {
                    stale.Add(id);
                }
            }

            foreach (var id in stale)
            {
                _hideAt.Remove(id);
            }

            stale.Clear();
            foreach (var id in _holdState.Keys)
            {
                if (!live.Contains(id))
                {
                    stale.Add(id);
                }
            }

            foreach (var id in stale)
            {
                _holdState.Remove(id);
                _lastRev.Remove(id);
            }
        }

        private void ResetHideSchedule()
        {
            _lastRev.Clear();
            _holdState.Clear();
            _hideAt.Clear();
            UpdateHideSchedule();
        }

        private bool ExpireHidden()
        {
            if (_hideAt.Count == 0)
            {
                return false;
            }

            var now = DateTime.UtcNow;
            var due = new List<string>();
            foreach (var pair in _hideAt)
            {
                if (pair.Value <= now)
                {
                    due.Add(pair.Key);
                }
            }

            var changed = false;
            foreach (var id in due)
            {
                _hideAt.Remove(id);
                foreach (var session in _activity.Sessions)
                {
                    if (string.Equals(session.Id, id, StringComparison.Ordinal))
                    {
                        _hidden[id] = session.Rev;
                        changed = true;
                        break;
                    }
                }
            }

            return changed;
        }

        // ------------------------------------------------------------------
        // Sprite

        /// <summary>
        /// The settings page or another install can replace the active atlas
        /// without changing `active`; poll its stamp so the pet reloads, exactly
        /// like the macOS page's mtime query parameter.
        /// </summary>
        private void RefreshSpriteIfChanged()
        {
            if (string.IsNullOrEmpty(_ui.Active) || _exiting)
            {
                return;
            }

            string resolveError;
            var sprite = SpriteResolver.Resolve(_petsRoot, _ui.Active, out resolveError);
            if (sprite == null)
            {
                if (_sheet != null || _spritePath != null)
                {
                    Log.Debug("sprite disappeared: " + resolveError);
                    ClearSheet();
                }

                return;
            }

            FileInfo info;
            try
            {
                info = new FileInfo(sprite);
                if (!info.Exists)
                {
                    return;
                }
            }
            catch (Exception)
            {
                return;
            }

            if (string.Equals(_spritePath, sprite, StringComparison.OrdinalIgnoreCase) &&
                _spriteStamp == info.LastWriteTimeUtc &&
                _spriteLength == info.Length)
            {
                return;
            }

            LoadSheet();
        }

        private void LoadSheet()
        {
            try
            {
                if (string.IsNullOrEmpty(_ui.Active))
                {
                    ClearSheet();
                    return;
                }

                string resolveError;
                var sprite = SpriteResolver.Resolve(_petsRoot, _ui.Active, out resolveError);
                if (sprite == null)
                {
                    Log.Debug("sprite unavailable: " + resolveError);
                    ClearSheet();
                    return;
                }

                var info = new FileInfo(sprite);
                if (_sheet != null &&
                    string.Equals(_spritePath, sprite, StringComparison.OrdinalIgnoreCase) &&
                    _spriteStamp == info.LastWriteTimeUtc &&
                    _spriteLength == info.Length)
                {
                    return;
                }

                // Record the attempt before decoding. A corrupt atlas must not
                // be retried on every poll; the next file change retries.
                _spritePath = sprite;
                _spriteStamp = info.LastWriteTimeUtc;
                _spriteLength = info.Length;

                string bitmapError;
                var bitmap = SpriteResolver.EnsureBitmap(
                    sprite,
                    _ui.Active,
                    Path.Combine(_configDir, "cache"),
                    out bitmapError);
                if (!string.IsNullOrEmpty(bitmapError))
                {
                    Log.Debug("webp conversion: " + bitmapError);
                }

                var sheet = SpriteSheet.Load(bitmap);
                _sheet = sheet;
                UpdateStageSize();
                Log.Debug("sprite " + sprite + " " + sheet.FrameWidth + "x" + sheet.FrameHeight +
                          " rows=" + sheet.Rows.ToString(CultureInfo.InvariantCulture));
                Play(_currentPose, _currentHold, true);
                Relayout();
            }
            catch (Exception exception)
            {
                Log.Error("sprite load failed", exception);
                DropSheet();
            }
        }

        /// <summary>Invisible pet, but keep the attempted stamp so it is not retried.</summary>
        private void DropSheet()
        {
            _sheet = null;
            _sprite.Source = null;
            _frameTimer.Stop();
            UpdateStageSize();
            Relayout();
        }

        private void ClearSheet()
        {
            DropSheet();
            _spritePath = null;
            _spriteStamp = DateTime.MinValue;
            _spriteLength = 0;
        }

        private void UpdateStageSize()
        {
            if (_sheet == null)
            {
                _stage.Width = 0;
                _stage.Height = 0;
                _sprite.Width = 0;
                _sprite.Height = 0;
                _sprite.Source = null;
                return;
            }

            var width = Math.Max(1, _sheet.FrameWidth * _ui.Scale);
            var height = Math.Max(1, _sheet.FrameHeight * _ui.Scale);
            _stage.Width = width;
            _stage.Height = height;
            _sprite.Width = width;
            _sprite.Height = height;
        }

        private void UpdatePose(bool force)
        {
            if (!_loaded || _exiting || _sheet == null)
            {
                return;
            }

            if (_dragging)
            {
                // Before the pointer moves there is no direction yet; keep the
                // current animation rather than dropping to idle mid-press.
                if (_dragDirection != null)
                {
                    Play(_dragDirection, true, force);
                }

                return;
            }

            if (DateTime.UtcNow < _waveUntil)
            {
                Play("waving", false, false);
                return;
            }

            var state = "idle";
            var hold = true;
            SessionInfo holder = null;
            foreach (var session in _activity.Sessions)
            {
                if (session.Hold)
                {
                    holder = session;
                    break;
                }
            }

            if (holder != null)
            {
                state = holder.State;
                hold = true;
            }
            else if (_activity.Sessions.Count > 0)
            {
                var first = _activity.Sessions[0];
                if (first.State == "waving" || first.State == "failed")
                {
                    state = first.State;
                    hold = false;
                }
            }

            Play(state, hold, force);
        }

        private void Play(string state, bool hold, bool force)
        {
            if (_sheet == null)
            {
                return;
            }

            var pose = Pose.Find(state) ?? Pose.Idle;
            if (!force && pose.Id == _currentPose && hold == _currentHold)
            {
                return;
            }

            _currentPose = pose.Id;
            _currentHold = hold;
            _frameIndex = 0;
            _frameTimer.Stop();
            _frameTimer.Interval = TimeSpan.FromMilliseconds(
                Math.Max(24.0, (double)pose.DurationMs / Math.Max(1, pose.Frames)));
            _frameTimer.Start();
            ApplyFrame();

            _idleTimer.Stop();
            if (!hold)
            {
                _idleTimer.Interval = TimeSpan.FromMilliseconds(
                    Math.Max(1400, pose.DurationMs * 2.0));
                _idleTimer.Start();
            }
        }

        private void ApplyFrame()
        {
            if (_sheet == null)
            {
                _sprite.Source = null;
                return;
            }

            var pose = Pose.Find(_currentPose) ?? Pose.Idle;
            var frames = _sheet.Frames(pose);
            if (frames.Length == 0)
            {
                _sprite.Source = null;
                return;
            }

            _sprite.Source = frames[_frameIndex % frames.Length];
        }

        private void OnFrameTick(object sender, EventArgs e)
        {
            if (_sheet == null)
            {
                _frameTimer.Stop();
                return;
            }

            var pose = Pose.Find(_currentPose) ?? Pose.Idle;
            if (_frameIndex + 1 >= Math.Max(1, pose.Frames))
            {
                _frameIndex = 0;
            }
            else
            {
                _frameIndex += 1;
            }

            ApplyFrame();
        }

        private void OnIdleTick(object sender, EventArgs e)
        {
            _idleTimer.Stop();
            if (_dragging || DateTime.UtcNow < _waveUntil || _exiting)
            {
                return;
            }

            Play("idle", true, false);
        }

        private void OnWaveTick(object sender, EventArgs e)
        {
            _waveTimer.Stop();
            _waveUntil = DateTime.MinValue;
            UpdatePose(true);
        }

        // ------------------------------------------------------------------
        // Bubbles

        private void ApplyBubbleStyle()
        {
            _bubblePanel.Opacity = UiConfig.ClampNumber(_ui.BubbleOpacity, 0, 100) / 100.0;

            Color textColor;
            try
            {
                var converted = ColorConverter.ConvertFromString(_ui.BubbleTextColor);
                textColor = converted is Color ? (Color)converted : Colors.White;
            }
            catch (Exception)
            {
                textColor = Colors.White;
            }

            var brush = new SolidColorBrush(textColor);
            brush.Freeze();
            _collapse.Foreground = brush;
        }

        private void RebuildBubbles()
        {
            var poseChanged = ExpireHidden();

            var visible = new List<SessionInfo>();
            foreach (var session in _activity.Sessions)
            {
                if (session.Hold)
                {
                    visible.Add(session);
                    continue;
                }

                long hiddenRev;
                if (_hidden.TryGetValue(session.Id, out hiddenRev) && hiddenRev == session.Rev)
                {
                    continue;
                }

                visible.Add(session);
            }

            if (!_ui.Bubbles)
            {
                ClearBubbles();
                _bubblePanel.Visibility = Visibility.Collapsed;
                _collapse.Visibility = Visibility.Collapsed;
                Relayout();
                if (poseChanged)
                {
                    UpdatePose(false);
                }

                return;
            }

            _bubblePanel.Visibility = Visibility.Visible;
            if (visible.Count == 0)
            {
                ClearBubbles();
                _collapse.Visibility = Visibility.Collapsed;
                Relayout();
                if (poseChanged)
                {
                    UpdatePose(false);
                }

                return;
            }

            var multi = visible.Count > 1;
            var show = new List<SessionInfo>();
            if (multi && !_expanded)
            {
                show.Add(visible[0]);
            }
            else
            {
                show.AddRange(visible);
            }

            var key = new StringBuilder();
            key.Append(multi ? (_expanded ? "x" : "c") : "s");
            foreach (var session in show)
            {
                key.Append('|').Append(session.Id);
            }

            var rebuild = _bubbleAppearanceDirty || !string.Equals(_structureKey, key.ToString(), StringComparison.Ordinal);
            if (!rebuild && _bubbleViews.Count != show.Count)
            {
                rebuild = true;
            }

            if (rebuild)
            {
                _bubbleAppearanceDirty = false;
                _structureKey = key.ToString();
                _bubblePanel.Children.Clear();
                _bubbleViews.Clear();
                for (var index = 0; index < show.Count; index += 1)
                {
                    var view = new BubbleView(_ui, ActivateSession);
                    view.Root.Margin = new Thickness(0, 0, 0, index < show.Count - 1 ? 4 : 0);
                    _bubblePanel.Children.Add(view.Root);
                    _bubbleViews[show[index].Id] = view;
                }
            }

            for (var index = 0; index < show.Count; index += 1)
            {
                BubbleView view;
                if (!_bubbleViews.TryGetValue(show[index].Id, out view))
                {
                    continue;
                }

                var extra = index == 0 && multi && !_expanded ? visible.Count - 1 : 0;
                view.Update(show[index], extra);
            }

            _collapse.Visibility = multi && _expanded ? Visibility.Visible : Visibility.Collapsed;
            Relayout();

            if (poseChanged)
            {
                UpdatePose(false);
            }
        }

        private void ClearBubbles()
        {
            _bubbleViews.Clear();
            _bubblePanel.Children.Clear();
            _structureKey = string.Empty;
        }

        private void ActivateSession(SessionInfo session)
        {
            if (session == null)
            {
                return;
            }

            if (_activity.Sessions.Count > 1 && !_expanded)
            {
                _expanded = true;
                RebuildBubbles();
                return;
            }

            OpenUrl(session.Open);
        }

        private void OpenUrl(string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                OpenParentWindow();
                return;
            }

            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri))
            {
                return;
            }

            if (!string.Equals(uri.Scheme, "dsh", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(uri.Scheme, "http", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch (Exception exception)
            {
                Log.Debug("open " + url + ": " + exception.Message);
                OpenParentWindow();
            }
        }

        private void OpenParentWindow()
        {
            if (_parentPid > 1)
            {
                try
                {
                    using (var parent = Process.GetProcessById(_parentPid))
                    {
                        var handle = parent.MainWindowHandle;
                        if (handle != IntPtr.Zero)
                        {
                            Native.ActivateWindow(handle);
                            return;
                        }
                    }
                }
                catch (Exception)
                {
                }
            }

            // The Host process is often an Electron utility process without a
            // window. Fall back to the desktop app itself when it is running.
            try
            {
                foreach (var process in Process.GetProcessesByName("DeepSeek Harness"))
                {
                    try
                    {
                        var handle = process.MainWindowHandle;
                        if (handle != IntPtr.Zero)
                        {
                            Native.ActivateWindow(handle);
                            return;
                        }
                    }
                    catch (Exception)
                    {
                    }
                    finally
                    {
                        process.Dispose();
                    }
                }
            }
            catch (Exception)
            {
            }
        }

        // ------------------------------------------------------------------
        // Window geometry

        private void Relayout()
        {
            if (!_loaded || _exiting)
            {
                return;
            }

            _root.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            var desired = _root.DesiredSize;
            var width = Math.Max(40, Math.Ceiling(desired.Width));
            var height = Math.Max(40, Math.Ceiling(desired.Height));
            if (Math.Abs(width - Width) < 0.5 && Math.Abs(height - Height) < 0.5)
            {
                return;
            }

            var bottom = Top + Height;
            var center = Left + Width / 2.0;
            Width = width;
            Height = height;

            if (!_positionApplied)
            {
                return;
            }

            // The page is bottom-anchored: growing bubbles push the window up,
            // not the pet down.
            Left = center - width / 2.0;
            Top = bottom - height;
            ClampPosition();
            Log.Debug("resize " + width.ToString(CultureInfo.InvariantCulture) + "x" +
                      height.ToString(CultureInfo.InvariantCulture));
        }

        private void ApplyInitialPosition()
        {
            if (_pendingHasPosition)
            {
                Left = _pendingLeft;
                Top = _pendingTop;
            }
            else
            {
                var work = SystemParameters.WorkArea;
                Left = work.Right - Width - 48;
                Top = work.Bottom - Height - 72;
            }

            ClampPosition();
        }

        private void ClampPosition()
        {
            var left = SystemParameters.VirtualScreenLeft;
            var top = SystemParameters.VirtualScreenTop;
            var width = SystemParameters.VirtualScreenWidth;
            var height = SystemParameters.VirtualScreenHeight;
            if (width <= 0 || height <= 0)
            {
                return;
            }

            if (double.IsNaN(Left) || double.IsInfinity(Left))
            {
                Left = left;
            }

            if (double.IsNaN(Top) || double.IsInfinity(Top))
            {
                Top = top;
            }

            if (Width >= width)
            {
                Left = left;
            }
            else
            {
                Left = Math.Min(Math.Max(Left, left), left + width - Width);
            }

            if (Height >= height)
            {
                Top = top;
            }
            else
            {
                Top = Math.Min(Math.Max(Top, top), top + height - Height);
            }
        }

        private void SavePosition()
        {
            try
            {
                var raw = Json.ReadObject(UiPath);
                raw["winX"] = (int)Math.Round(Left);
                raw["winY"] = (int)Math.Round(Top);
                Json.WriteObject(UiPath, raw);
            }
            catch (Exception exception)
            {
                Log.Debug("save position: " + exception.Message);
            }
        }

        // ------------------------------------------------------------------
        // Dragging and clicking

        private void OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
        {
            if (_exiting || !_ui.Visible || _ui.ClickThrough || e.ChangedButton != MouseButton.Left)
            {
                return;
            }

            Native.POINT cursor;
            if (!Native.GetCursorPos(out cursor))
            {
                return;
            }

            var dpi = VisualTreeHelper.GetDpi(this);
            _dragScaleX = dpi.DpiScaleX > 0 ? dpi.DpiScaleX : 1;
            _dragScaleY = dpi.DpiScaleY > 0 ? dpi.DpiScaleY : 1;
            _dragStartCursor = cursor;
            _dragStartLeft = Left;
            _dragStartTop = Top;
            _dragStarted = DateTime.UtcNow;
            _dragMoved = false;
            _dragDirection = null;
            _dragging = true;
            _dragTimer.Start();
            e.Handled = true;
        }

        private void OnDragTick(object sender, EventArgs e)
        {
            if (_exiting || !_dragging)
            {
                _dragTimer.Stop();
                return;
            }

            // A short grace period avoids treating the mouseDown frame itself as
            // a release before the hardware state has settled.
            if ((DateTime.UtcNow - _dragStarted).TotalMilliseconds > 50 && !Native.LeftButtonDown())
            {
                FinishDrag();
                return;
            }

            Native.POINT cursor;
            if (!Native.GetCursorPos(out cursor))
            {
                return;
            }

            var dx = (cursor.X - _dragStartCursor.X) / _dragScaleX;
            var dy = (cursor.Y - _dragStartCursor.Y) / _dragScaleY;
            if (Math.Abs(dx) > 2 || Math.Abs(dy) > 2)
            {
                _dragMoved = true;
            }

            Left = _dragStartLeft + dx;
            Top = _dragStartTop + dy;

            if (Math.Abs(dx) > 2)
            {
                var direction = dx > 0 ? "running-right" : "running-left";
                if (!string.Equals(direction, _dragDirection, StringComparison.Ordinal))
                {
                    _dragDirection = direction;
                    Play(direction, true, true);
                }
            }
        }

        private void FinishDrag()
        {
            _dragging = false;
            _dragTimer.Stop();
            ClampPosition();

            if (_dragMoved)
            {
                SavePosition();
                UpdatePose(true);
            }
            else
            {
                Wave();
            }
        }

        private void Wave()
        {
            _waveUntil = DateTime.UtcNow.AddMilliseconds(1500);
            _waveTimer.Stop();
            _waveTimer.Interval = TimeSpan.FromMilliseconds(1500);
            _waveTimer.Start();
            Play("waving", false, true);
        }

        // ------------------------------------------------------------------
        // Win32 styles and parent lifetime

        private void ApplyWindowStyle()
        {
            if (_hwnd == IntPtr.Zero)
            {
                return;
            }

            try
            {
                var style = Native.GetWindowLongPtr(_hwnd, Native.GWL_EXSTYLE);
                style |= Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_LAYERED;
                if (!_ui.Visible || _ui.ClickThrough)
                {
                    style |= Native.WS_EX_TRANSPARENT;
                }
                else
                {
                    style &= ~Native.WS_EX_TRANSPARENT;
                }

                Native.SetWindowLongPtr(_hwnd, Native.GWL_EXSTYLE, style);
                Native.SetWindowPos(
                    _hwnd,
                    IntPtr.Zero,
                    0,
                    0,
                    0,
                    0,
                    Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOZORDER |
                    Native.SWP_NOACTIVATE | Native.SWP_FRAMECHANGED);
            }
            catch (Exception exception)
            {
                Log.Debug("window style: " + exception.Message);
            }
        }

        private void OnParentTick(object sender, EventArgs e)
        {
            if (_exiting || _parentPid <= 1)
            {
                return;
            }

            try
            {
                using (var parent = Process.GetProcessById(_parentPid))
                {
                    if (parent.HasExited)
                    {
                        Exit();
                    }
                }
            }
            catch (ArgumentException)
            {
                Exit();
            }
            catch (InvalidOperationException)
            {
                Exit();
            }
            catch (Exception exception)
            {
                // Access denied is not proof of death; keep polling.
                Log.Debug("parent check: " + exception.Message);
            }
        }
    }
}
