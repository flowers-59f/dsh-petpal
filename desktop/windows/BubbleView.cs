// One session bubble: title row (icon + title + "+N"), status line, and the
// click that either expands the stack or opens DSH.
using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;

namespace PetPal
{
    internal sealed class BubbleView
    {
        private static readonly Color Green = Color.FromRgb(0x3F, 0xB9, 0x50);
        private static readonly Color Red = Color.FromRgb(0xF8, 0x51, 0x49);
        private static readonly Color Amber = Color.FromRgb(0xF0, 0xB4, 0x29);

        private readonly Border _root;
        private readonly ContentControl _iconHost;
        private readonly TextBlock _title;
        private readonly TextBlock _count;
        private readonly TextBlock _line;
        private readonly Brush _textBrush;
        private readonly Color _textColor;
        private readonly Action<SessionInfo> _activate;

        private SessionInfo _session;
        private string _iconKey;
        private bool _activeStyle;
        private string _lineText;
        private bool _pressed;

        public Border Root
        {
            get { return _root; }
        }

        public BubbleView(UiConfig ui, Action<SessionInfo> activate)
        {
            _activate = activate;
            _textColor = ParseColor(ui.BubbleTextColor, Colors.White);
            var background = ParseColor(ui.BubbleColor, Color.FromRgb(0x0F, 0x0F, 0x0F));
            _textBrush = Frozen(new SolidColorBrush(_textColor));

            _root = new Border
            {
                Width = ui.BubbleMaxWidth,
                Background = Frozen(new SolidColorBrush(background)),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(8, 4, 8, 5),
                Cursor = Cursors.Hand,
                SnapsToDevicePixels = true,
                Focusable = false,
            };

            var body = new StackPanel { Orientation = Orientation.Vertical };

            var head = new Grid { MinHeight = 17 };
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            _iconHost = new ContentControl
            {
                Width = 15,
                Height = 15,
                VerticalAlignment = VerticalAlignment.Center,
                Focusable = false,
            };
            Grid.SetColumn(_iconHost, 0);

            _title = new TextBlock
            {
                FontSize = ui.BubbleFontSize,
                FontWeight = FontWeights.SemiBold,
                Foreground = _textBrush,
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = HorizontalAlignment.Stretch,
                Margin = new Thickness(6, 0, 0, 0),
            };
            Grid.SetColumn(_title, 1);

            _count = new TextBlock
            {
                FontSize = Math.Max(8, ui.BubbleFontSize * 0.8),
                Foreground = _textBrush,
                Opacity = 0.55,
                VerticalAlignment = VerticalAlignment.Center,
                Margin = new Thickness(6, 0, 0, 0),
                Visibility = Visibility.Collapsed,
            };
            Grid.SetColumn(_count, 2);

            head.Children.Add(_iconHost);
            head.Children.Add(_title);
            head.Children.Add(_count);

            _line = new TextBlock
            {
                FontSize = ui.BubbleFontSize * 0.94,
                Foreground = _textBrush,
                Opacity = 0.72,
                Margin = new Thickness(21, 1, 0, 0),
                TextTrimming = TextTrimming.CharacterEllipsis,
                TextWrapping = TextWrapping.NoWrap,
            };

            body.Children.Add(head);
            body.Children.Add(_line);
            _root.Child = body;

            // A press on a bubble must not start a window drag; only a release
            // that belongs to a press inside this bubble performs the action.
            _root.MouseLeftButtonDown += delegate(object sender, MouseButtonEventArgs e)
            {
                _pressed = true;
                e.Handled = true;
            };
            _root.MouseLeave += delegate(object sender, MouseEventArgs e)
            {
                _pressed = false;
            };
            _root.MouseLeftButtonUp += delegate(object sender, MouseButtonEventArgs e)
            {
                e.Handled = true;
                if (!_pressed)
                {
                    return;
                }

                _pressed = false;
                if (_session != null && _activate != null)
                {
                    _activate(_session);
                }
            };
        }

        public void Update(SessionInfo session, int extraCount)
        {
            _session = session;

            var title = SessionText.Title(session);
            _title.Text = title;
            _title.ToolTip = title;

            if (extraCount > 0)
            {
                _count.Text = SessionText.Count(extraCount);
                _count.Visibility = Visibility.Visible;
            }
            else
            {
                _count.Text = string.Empty;
                _count.Visibility = Visibility.Collapsed;
            }

            var line = SessionText.StatusLine(session);
            if (!string.Equals(line, _lineText, StringComparison.Ordinal))
            {
                _lineText = line;
                _line.Text = line;
            }

            _line.ToolTip = line;

            var iconKey = SessionText.IconKey(session);
            if (!string.Equals(iconKey, _iconKey, StringComparison.Ordinal))
            {
                _iconKey = iconKey;
                _iconHost.Content = BuildIcon(iconKey);
            }

            var active = SessionText.IsActiveStatus(session.Status);
            if (active != _activeStyle)
            {
                _activeStyle = active;
                ApplyLineStyle(active);
            }
        }

        private void ApplyLineStyle(bool active)
        {
            if (active)
            {
                _line.BeginAnimation(UIElement.OpacityProperty, null);
                _line.Opacity = 1;
                try
                {
                    _line.Foreground = CreateShimmerBrush();
                }
                catch (Exception)
                {
                    _line.Foreground = _textBrush;
                    var pulse = new DoubleAnimation
                    {
                        From = 0.55,
                        To = 1.0,
                        Duration = TimeSpan.FromSeconds(0.9),
                        AutoReverse = true,
                        RepeatBehavior = RepeatBehavior.Forever,
                    };
                    _line.BeginAnimation(UIElement.OpacityProperty, pulse);
                }
            }
            else
            {
                _line.BeginAnimation(UIElement.OpacityProperty, null);
                _line.Foreground = _textBrush;
                _line.Opacity = 0.72;
            }
        }

        /// <summary>The page's moving highlight over the streaming status text.</summary>
        private Brush CreateShimmerBrush()
        {
            var low = Color.FromArgb(0x73, _textColor.R, _textColor.G, _textColor.B);
            var brush = new LinearGradientBrush
            {
                StartPoint = new Point(0, 0),
                EndPoint = new Point(1, 0),
                MappingMode = BrushMappingMode.RelativeToBoundingBox,
            };
            brush.GradientStops.Add(new GradientStop(low, 0.0));
            var middle = new GradientStop(_textColor, 0.5);
            brush.GradientStops.Add(middle);
            brush.GradientStops.Add(new GradientStop(low, 1.0));

            var sweep = new DoubleAnimation
            {
                From = 0.12,
                To = 0.95,
                Duration = TimeSpan.FromSeconds(1.9),
                RepeatBehavior = RepeatBehavior.Forever,
            };
            middle.BeginAnimation(GradientStop.OffsetProperty, sweep);
            return brush;
        }

        private UIElement BuildIcon(string key)
        {
            var canvas = new Canvas { Width = 15, Height = 15 };
            switch (key)
            {
                case "done":
                {
                    var circle = new Ellipse
                    {
                        Width = 14,
                        Height = 14,
                        Fill = Frozen(new SolidColorBrush(Green)),
                    };
                    Canvas.SetLeft(circle, 0.5);
                    Canvas.SetTop(circle, 0.5);
                    var check = new Path
                    {
                        Data = Geometry.Parse("M4.5,7.7 L6.7,9.9 L10.7,5.9"),
                        Stroke = Brushes.White,
                        StrokeThickness = 1.7,
                        StrokeStartLineCap = PenLineCap.Round,
                        StrokeEndLineCap = PenLineCap.Round,
                        StrokeLineJoin = PenLineJoin.Round,
                    };
                    canvas.Children.Add(circle);
                    canvas.Children.Add(check);
                    break;
                }

                case "failed":
                {
                    var circle = new Ellipse
                    {
                        Width = 14,
                        Height = 14,
                        Fill = Frozen(new SolidColorBrush(Red)),
                    };
                    Canvas.SetLeft(circle, 0.5);
                    Canvas.SetTop(circle, 0.5);
                    var cross = new Path
                    {
                        Data = Geometry.Parse("M5.2,5.2 L9.8,9.8 M9.8,5.2 L5.2,9.8"),
                        Stroke = Brushes.White,
                        StrokeThickness = 1.6,
                        StrokeStartLineCap = PenLineCap.Round,
                        StrokeEndLineCap = PenLineCap.Round,
                    };
                    canvas.Children.Add(circle);
                    canvas.Children.Add(cross);
                    break;
                }

                case "waiting":
                {
                    var dot = new Ellipse
                    {
                        Width = 7,
                        Height = 7,
                        Fill = Frozen(new SolidColorBrush(Amber)),
                    };
                    Canvas.SetLeft(dot, 4);
                    Canvas.SetTop(dot, 4);
                    canvas.Children.Add(dot);
                    break;
                }

                default:
                {
                    var spinner = new Canvas { Width = 10, Height = 10 };
                    var ring = new Ellipse
                    {
                        Width = 10,
                        Height = 10,
                        Stroke = Frozen(new SolidColorBrush(_textColor)),
                        StrokeThickness = 1.5,
                        Opacity = 0.22,
                    };
                    spinner.Children.Add(ring);

                    var arc = new Path
                    {
                        Data = Geometry.Parse("M5,0.75 A4.25,4.25 0 0 1 9.25,5"),
                        Stroke = Frozen(new SolidColorBrush(_textColor)),
                        StrokeThickness = 1.5,
                        StrokeStartLineCap = PenLineCap.Round,
                        StrokeEndLineCap = PenLineCap.Round,
                    };
                    var rotate = new RotateTransform(0, 5, 5);
                    arc.RenderTransform = rotate;
                    var spin = new DoubleAnimation
                    {
                        From = 0,
                        To = 360,
                        Duration = TimeSpan.FromMilliseconds(800),
                        RepeatBehavior = RepeatBehavior.Forever,
                    };
                    rotate.BeginAnimation(RotateTransform.AngleProperty, spin);
                    spinner.Children.Add(arc);

                    Canvas.SetLeft(spinner, 2.5);
                    Canvas.SetTop(spinner, 2.5);
                    canvas.Children.Add(spinner);
                    break;
                }
            }

            return canvas;
        }

        private static Color ParseColor(string value, Color fallback)
        {
            if (string.IsNullOrEmpty(value))
            {
                return fallback;
            }

            try
            {
                var converted = ColorConverter.ConvertFromString(value);
                if (converted is Color)
                {
                    return (Color)converted;
                }
            }
            catch (Exception)
            {
            }

            return fallback;
        }

        private static SolidColorBrush Frozen(SolidColorBrush brush)
        {
            brush.Freeze();
            return brush;
        }
    }
}
