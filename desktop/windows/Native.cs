// Win32 interop for the Windows desktop companion:
//   * per-monitor DPI awareness
//   * layered/tool/no-activate window styles, so the pet never shows up in the
//     taskbar or Alt+Tab and never steals keyboard focus
//   * cursor polling for dragging (a small always-on-top window cannot rely on
//     WPF mouse capture once the pointer leaves it)
using System;
using System.Runtime.InteropServices;

namespace PetPal
{
    internal static class Native
    {
        public const int GWL_EXSTYLE = -20;

        public const long WS_EX_TRANSPARENT = 0x00000020L;
        public const long WS_EX_TOOLWINDOW = 0x00000080L;
        public const long WS_EX_LAYERED = 0x00080000L;
        public const long WS_EX_NOACTIVATE = 0x08000000L;

        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_FRAMECHANGED = 0x0020;

        public const int SW_RESTORE = 9;
        public const int VK_LBUTTON = 0x01;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetCursorPosNative(out POINT point);

        public static bool GetCursorPos(out POINT point)
        {
            try
            {
                return GetCursorPosNative(out point);
            }
            catch (Exception)
            {
                point = new POINT();
                return false;
            }
        }

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int key);

        /// <summary>Left mouse button currently pressed. Bit 15 is the down state.</summary>
        public static bool LeftButtonDown()
        {
            try
            {
                return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
            }
            catch (Exception)
            {
                return false;
            }
        }

        [DllImport("user32.dll", EntryPoint = "SetProcessDpiAwarenessContext", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetProcessDpiAwarenessContextNative(IntPtr value);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetProcessDPIAware();

        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(int value);

        /// <summary>
        /// Must run before WPF creates its first window. The embedded manifest
        /// already asks for PerMonitorV2; the calls below are a fallback for
        /// hosts that ignore the manifest or run an older Windows build.
        /// </summary>
        public static void EnablePerMonitorDpi()
        {
            try
            {
                // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
                if (SetProcessDpiAwarenessContextNative(new IntPtr(-4)))
                {
                    return;
                }
            }
            catch (EntryPointNotFoundException)
            {
            }
            catch (DllNotFoundException)
            {
            }
            catch (Exception)
            {
            }

            try
            {
                const int PROCESS_PER_MONITOR_DPI_AWARE = 2;
                if (SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE) == 0)
                {
                    return;
                }
            }
            catch (Exception)
            {
            }

            try
            {
                SetProcessDPIAware();
            }
            catch (Exception)
            {
            }
        }

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW", SetLastError = true)]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
        private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
        private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr value);

        [DllImport("user32.dll", EntryPoint = "SetWindowLongW", SetLastError = true)]
        private static extern int SetWindowLong32(IntPtr hWnd, int nIndex, int value);

        public static long GetWindowLongPtr(IntPtr hWnd, int nIndex)
        {
            if (IntPtr.Size == 8)
            {
                return GetWindowLongPtr64(hWnd, nIndex).ToInt64();
            }

            return GetWindowLong32(hWnd, nIndex);
        }

        public static void SetWindowLongPtr(IntPtr hWnd, int nIndex, long value)
        {
            if (IntPtr.Size == 8)
            {
                SetWindowLongPtr64(hWnd, nIndex, new IntPtr(value));
                return;
            }

            SetWindowLong32(hWnd, nIndex, unchecked((int)value));
        }

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWindowPosNative(
            IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

        public static void SetWindowPos(
            IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags)
        {
            try
            {
                SetWindowPosNative(hWnd, insertAfter, x, y, cx, cy, flags);
            }
            catch (Exception)
            {
            }
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindowNative(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindowNative(IntPtr hWnd, int command);

        public static void ActivateWindow(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero)
            {
                return;
            }

            try
            {
                ShowWindowNative(hWnd, SW_RESTORE);
                SetForegroundWindowNative(hWnd);
            }
            catch (Exception)
            {
            }
        }
    }
}
