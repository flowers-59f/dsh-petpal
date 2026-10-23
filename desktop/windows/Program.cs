// Entry point for the Windows desktop companion.
//
// The Host half spawns PetPal.exe detached with:
//   PETDEX_HOME       the DSH pet library (<home>/.dsh/pets)
//   PETDEX_PARENT_PID the Harness process, watched so the pet never outlives it
//   PETDEX_DEBUG=1    optional verbose logging
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace PetPal
{
    internal static class Program
    {
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        [STAThread]
        private static int Main(string[] args)
        {
            Native.EnablePerMonitorDpi();

            var petsRoot = ResolvePetsRoot();
            var configDir = Path.Combine(petsRoot, ".petdex");
            try
            {
                Directory.CreateDirectory(configDir);
            }
            catch (Exception)
            {
                // The window still runs; only persistence/logging are affected.
            }

            Log.Init(configDir, Environment.GetEnvironmentVariable("PETDEX_DEBUG") == "1");

            var pid = Process.GetCurrentProcess().Id;
            var pidPath = Path.Combine(configDir, "app.pid");

            try
            {
                if (PidFile.IsAnotherInstanceRunning(pidPath, pid))
                {
                    Log.Debug("another PetPal instance is already running");
                    return 0;
                }

                PidFile.Write(pidPath, pid);

                var app = new Application
                {
                    ShutdownMode = ShutdownMode.OnExplicitShutdown,
                };

                app.DispatcherUnhandledException += delegate(object sender, DispatcherUnhandledExceptionEventArgs e)
                {
                    Log.Error("dispatcher unhandled", e.Exception);
                    e.Handled = true;
                    try
                    {
                        app.Shutdown(1);
                    }
                    catch (Exception)
                    {
                    }
                };

                AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e)
                {
                    Log.Error("unhandled", e.ExceptionObject as Exception);
                };

                var window = new PetPalWindow(petsRoot, configDir, ReadParentPid());
                Log.Debug("starting pid=" + pid.ToString(CultureInfo.InvariantCulture));
                app.Run(window);
                return 0;
            }
            catch (Exception exception)
            {
                Log.Error("fatal", exception);
                return 1;
            }
            finally
            {
                PidFile.RemoveIfOurs(pidPath, pid);
            }
        }

        private static string ResolvePetsRoot()
        {
            var configured = Environment.GetEnvironmentVariable("PETDEX_HOME");
            if (!string.IsNullOrWhiteSpace(configured))
            {
                try
                {
                    return Path.GetFullPath(configured);
                }
                catch (Exception)
                {
                    return configured;
                }
            }

            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".dsh",
                "pets");
        }

        private static int ReadParentPid()
        {
            var raw = Environment.GetEnvironmentVariable("PETDEX_PARENT_PID");
            int pid;
            if (!string.IsNullOrWhiteSpace(raw) &&
                int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid) &&
                pid > 1)
            {
                return pid;
            }

            return 0;
        }
    }

    internal static class PidFile
    {
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        public static bool IsAnotherInstanceRunning(string path, int ownPid)
        {
            try
            {
                if (!File.Exists(path))
                {
                    return false;
                }

                var raw = File.ReadAllText(path, Encoding.UTF8).Trim();
                int pid;
                if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid) ||
                    pid <= 0 || pid == ownPid)
                {
                    return false;
                }

                try
                {
                    using (var process = System.Diagnostics.Process.GetProcessById(pid))
                    {
                        if (process.HasExited)
                        {
                            return false;
                        }

                        // A recycled PID must not block a new pet.
                        return string.Equals(process.ProcessName, "PetPal", StringComparison.OrdinalIgnoreCase);
                    }
                }
                catch (ArgumentException)
                {
                    return false;
                }
                catch (InvalidOperationException)
                {
                    return false;
                }
                catch (Exception)
                {
                    // Access denied: assume the instance is alive.
                    return true;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        public static void Write(string path, int pid)
        {
            try
            {
                var directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(path, pid.ToString(CultureInfo.InvariantCulture), Utf8NoBom);
            }
            catch (Exception exception)
            {
                Log.Debug("pid write failed: " + exception.Message);
            }
        }

        public static void RemoveIfOurs(string path, int pid)
        {
            try
            {
                if (!File.Exists(path))
                {
                    return;
                }

                var raw = File.ReadAllText(path, Encoding.UTF8).Trim();
                int current;
                if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out current) &&
                    current == pid)
                {
                    File.Delete(path);
                }
            }
            catch (Exception)
            {
            }
        }
    }
}
