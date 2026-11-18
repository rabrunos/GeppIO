// First-party Windows ABI bridge only. Suite selection, arguments and reports live in TypeScript.
// Supported Win32 contracts: CreateDesktopW, STARTUPINFOEX, Job Objects. Never SwitchDesktop/SendInput.
using System;
using System.ComponentModel;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class DesktopBridge {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public int size; public string reserved, desktop, title;
        public int x, y, width, height, columns, rows, fill, flags;
        public short show, reservedBytes; public IntPtr reservedPointer, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct Security { public int size; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long processTime, jobTime; public uint flags; public UIntPtr minimum, maximum;
        public uint active; public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong readOps, writeOps, otherOps, readBytes, writeBytes, otherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public BasicLimits basic; public IoCounters io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateDesktopW(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr security);
    [DllImport("user32.dll", SetLastError = true)] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenDesktopW(string name, uint flags, bool inherit, uint access);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr GetThreadDesktop(uint thread);
    delegate bool WindowVisitor(IntPtr window, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] static extern bool EnumDesktopWindows(IntPtr desktop, WindowVisitor visitor, IntPtr state);
    [DllImport("user32.dll", SetLastError = true)] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool GetUserObjectInformationW(IntPtr handle, int info, StringBuilder value, int bytes, out int needed);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr security, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int info, ref Limits limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int info, IntPtr data, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string executable, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string path, uint access, uint share, ref Security security, uint creation, uint attributes, IntPtr template);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint code);

    static void Need(bool success, string operation) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static string ObjectName(IntPtr handle) {
        Need(handle != IntPtr.Zero, "OBJECT_HANDLE"); var value = new StringBuilder(256); int needed;
        Need(GetUserObjectInformationW(handle, 2, value, value.Capacity * 2, out needed), "OBJECT_NAME"); return value.ToString();
    }
    static void CheckDesktopName(string desktop) { if (!Regex.IsMatch(desktop, "\\AGeppIOTest[0-9a-f]{32}\\z")) throw new Exception("DESKTOP_NAME"); }
    static void CheckStationAndInput(string desktop) {
        if (!ObjectName(GetProcessWindowStation()).Equals("WinSta0", StringComparison.OrdinalIgnoreCase)) throw new Exception("WINDOW_STATION");
        IntPtr input = OpenInputDesktop(0, false, 1); Need(input != IntPtr.Zero, "INPUT_DESKTOP_UNAVAILABLE");
        try { if (ObjectName(input).Equals(desktop, StringComparison.OrdinalIgnoreCase)) throw new Exception("TEST_DESKTOP_IS_VISIBLE"); }
        finally { Need(CloseDesktop(input), "INPUT_HANDLE_CLOSE"); }
    }
    static void VerifyWindow(IntPtr window, uint pid, uint tid, string desktop) {
        uint owner; uint thread = GetWindowThreadProcessId(window, out owner);
        if (thread == 0) throw new Exception("WINDOW_THREAD_UNOBSERVABLE");
        if (owner != pid) {
            string expectedName = "exited", observedName = "exited";
            try { using (var p = Process.GetProcessById((int)pid)) expectedName = p.ProcessName; } catch (ArgumentException) {}
            try { using (var p = Process.GetProcessById((int)owner)) observedName = p.ProcessName; } catch (ArgumentException) {}
            throw new Exception("WINDOW_PID_MISMATCH expected=" + pid + "/" + expectedName + " observed=" + owner + "/" + observedName + " queriedTid=" + tid + " actualTid=" + thread);
        }
        if (tid != 0 && thread != tid) throw new Exception("WINDOW_TID_MISMATCH expected=" + tid + " observed=" + thread);
        if (!ObjectName(GetThreadDesktop(thread)).Equals(desktop, StringComparison.OrdinalIgnoreCase)) throw new Exception("WINDOW_DESKTOP_ESCAPE");
    }
    // Only exact job-owned processes/windows. Non-GUI thread NULL results are not attestation.
    // Windows startup inheritance is enforced separately; every observable HWND is checked strictly.
    static int AttestProcess(Process target, IntPtr job, string desktop) {
        bool member; Need(IsProcessInJob(target.Handle, job, out member), "MEMBERSHIP_QUERY");
        if (!member) throw new Exception("LOST_PROCESS_OWNERSHIP"); int observable = 0;
        foreach (ProcessThread thread in target.Threads) {
            IntPtr handle = GetThreadDesktop((uint)thread.Id);
            if (handle != IntPtr.Zero) {
                if (!ObjectName(handle).Equals(desktop, StringComparison.OrdinalIgnoreCase)) throw new Exception("CHILD_DESKTOP_ESCAPE");
                observable++;
            }
        }
        return observable;
    }
    static int Attest(string pidText, string desktop) {
        CheckDesktopName(desktop); CheckStationAndInput(desktop); uint pid;
        if (!uint.TryParse(pidText, out pid) || pid == 0) throw new Exception("PROCESS_ID");
        IntPtr job = OpenJobObjectW(4, false, "Local\\" + desktop); Need(job != IntPtr.Zero, "JOB_NOT_FOUND");
        try { using (Process process = Process.GetProcessById((int)pid)) { if (AttestProcess(process, job, desktop) == 0) throw new Exception("DESKTOP_NOT_OBSERVABLE"); } }
        finally { Need(CloseHandle(job), "JOB_QUERY_CLOSE"); }
        Console.WriteLine("{\"kind\":\"attested\",\"desktop\":\"" + desktop + "\"}"); return 0;
    }
    static int AttestWindow(string pidText, string hwndText, string desktop) {
        CheckDesktopName(desktop); CheckStationAndInput(desktop); uint pid; ulong hwnd;
        if (!uint.TryParse(pidText, out pid) || pid == 0 || !Regex.IsMatch(hwndText, "\\A[0-9a-f]{1,16}\\z") || !ulong.TryParse(hwndText, System.Globalization.NumberStyles.HexNumber, null, out hwnd) || hwnd == 0 || hwnd > long.MaxValue) throw new Exception("WINDOW_ARGUMENTS");
        IntPtr job = OpenJobObjectW(4, false, "Local\\" + desktop); Need(job != IntPtr.Zero, "JOB_NOT_FOUND");
        try { using (Process target = Process.GetProcessById((int)pid)) { bool member; Need(IsProcessInJob(target.Handle, job, out member), "WINDOW_JOB_QUERY"); if (!member) throw new Exception("WINDOW_OUTSIDE_JOB"); VerifyWindow(new IntPtr((long)hwnd), pid, 0, desktop); } }
        finally { Need(CloseHandle(job), "WINDOW_JOB_CLOSE"); }
        Console.WriteLine("{\"kind\":\"window-attested\"}"); return 0;
    }
    static int VerifyAbsent(string desktop) {
        CheckDesktopName(desktop);
        IntPtr job = OpenJobObjectW(4, false, "Local\\" + desktop);
        if (job != IntPtr.Zero) { CloseHandle(job); throw new Exception("JOB_STILL_EXISTS"); }
        if (Marshal.GetLastWin32Error() != 2) throw new Exception("JOB_ABSENCE_UNOBSERVABLE");
        IntPtr desk = OpenDesktopW(desktop, 0, false, 1);
        if (desk != IntPtr.Zero) { CloseDesktop(desk); throw new Exception("DESKTOP_STILL_EXISTS"); }
        if (Marshal.GetLastWin32Error() != 2) throw new Exception("DESKTOP_ABSENCE_UNOBSERVABLE");
        Console.WriteLine("{\"kind\":\"resources-absent\"}"); return 0;
    }
    // Windows CRT quoting; CreateProcess receives an explicit executable, never cmd.exe/PATH.
    static string Quote(string value) {
        var output = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            output.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); slashes = 0; output.Append(c);
        }
        return output.Append('\\', slashes * 2).Append('"').ToString();
    }
    static int Active(IntPtr job) {
        IntPtr data = Marshal.AllocHGlobal(48);
        try { Need(QueryInformationJobObject(job, 1, data, 48, IntPtr.Zero), "JOB_ACCOUNTING"); return Marshal.ReadInt32(data, 40); }
        finally { Marshal.FreeHGlobal(data); }
    }
    static void MonitorInput(IntPtr job, string desktop) {
        IntPtr data = Marshal.AllocHGlobal(8 + 512 * IntPtr.Size), input = IntPtr.Zero;
        try {
            Need(QueryInformationJobObject(job, 3, data, (uint)(8 + 512 * IntPtr.Size), IntPtr.Zero), "INPUT_JOB_PROCESS_LIST");
            int count = Marshal.ReadInt32(data, 4); if (count < 0 || count > 512) throw new Exception("PROCESS_BOUND");
            var owned = new HashSet<uint>(); for (int i = 0; i < count; i++) owned.Add(checked((uint)Marshal.ReadIntPtr(data, 8 + i * IntPtr.Size).ToInt64()));
            input = OpenInputDesktop(0, false, 1); Need(input != IntPtr.Zero, "INPUT_DESKTOP_OBSERVATION");
            if (ObjectName(input).Equals(desktop, StringComparison.OrdinalIgnoreCase)) throw new Exception("TEST_DESKTOP_BECAME_INPUT");
            string failure = null;
            WindowVisitor visitor = delegate(IntPtr window, IntPtr unused) {
                uint pid; uint tid = GetWindowThreadProcessId(window, out pid);
                if (tid == 0 && IsWindow(window)) { failure = "INPUT_WINDOW_OWNERSHIP_UNAVAILABLE"; return false; }
                if (tid != 0 && owned.Contains(pid)) { failure = "OWNED_WINDOW_ON_INPUT_DESKTOP"; return false; }
                return true;
            };
            SetLastError(0); bool enumerated = EnumDesktopWindows(input, visitor, IntPtr.Zero); int error = Marshal.GetLastWin32Error();
            if (failure != null) throw new Exception(failure); if (!enumerated && error != 0) throw new Exception("INPUT_ENUMERATION_UNAVAILABLE");
        } finally { if (input != IntPtr.Zero) CloseDesktop(input); Marshal.FreeHGlobal(data); }
    }
    static int Run(string[] args) {
        if (args.Length != 6 || !Regex.IsMatch(args[4], "\\A[0-9a-f]{64}\\z")) throw new Exception("RUN_ARGUMENTS");
        string root = Path.GetFullPath(Environment.CurrentDirectory), node = Path.GetFullPath(args[1]);
        string worker = Path.GetFullPath(args[2]), request = Path.GetFullPath(args[3]); uint timeout;
        if (!Path.GetFileName(node).Equals("node.exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(node)
            || !worker.Equals(Path.Combine(root, "tools", "isolation", "isolation-worker.ts"), StringComparison.OrdinalIgnoreCase)
            || !request.StartsWith(Path.Combine(root, ".local", "isolation") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            || !File.Exists(worker) || !File.Exists(request) || !uint.TryParse(args[5], out timeout) || timeout < 1000 || timeout > 1800000) throw new Exception("RUN_PATH_OR_TIMEOUT");
        string desktop = "GeppIOTest" + Guid.NewGuid().ToString("N"); CheckStationAndInput(desktop);
        IntPtr callerInput = OpenInputDesktop(0, false, 1); Need(callerInput != IntPtr.Zero, "INPUT_OBSERVER_UNAVAILABLE");
        try { if (!ObjectName(GetThreadDesktop(GetCurrentThreadId())).Equals(ObjectName(callerInput), StringComparison.OrdinalIgnoreCase)) throw new Exception("CALLER_NOT_ON_INPUT_DESKTOP: use the normal Windows session, never a visible fallback"); }
        finally { CloseDesktop(callerInput); }
        IntPtr desk = IntPtr.Zero, job = IntPtr.Zero, attributes = IntPtr.Zero, handleList = IntPtr.Zero;
        IntPtr input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero; ProcessInfo child = new ProcessInfo();
        bool assigned = false, acquired = false, cleanup = true, attributesInitialized = false, interrupted = false; uint exit = 125;
        using (var mutex = new Mutex(false, "Local\\GeppIOIsolation-" + args[4]))
        using (var canceled = new ManualResetEvent(false)) {
            try {
                try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new Exception("CONCURRENT_INVOCATION");
                SetLastError(0); desk = CreateDesktopW(desktop, IntPtr.Zero, IntPtr.Zero, 0, 0xc7, IntPtr.Zero); int desktopError = Marshal.GetLastWin32Error(); Need(desk != IntPtr.Zero, "DESKTOP_CREATE");
                if (desktopError == 183) { CloseDesktop(desk); desk = IntPtr.Zero; throw new Exception("DESKTOP_ALREADY_EXISTS"); }
                SetLastError(0); job = CreateJobObjectW(IntPtr.Zero, "Local\\" + desktop); int jobError = Marshal.GetLastWin32Error(); Need(job != IntPtr.Zero, "JOB_CREATE");
                if (jobError == 183) { CloseHandle(job); job = IntPtr.Zero; throw new Exception("JOB_ALREADY_EXISTS"); }
                var limits = new Limits(); limits.basic.flags = 0x2000;
                Need(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))), "JOB_KILL_ON_CLOSE");
                var security = new Security { size = Marshal.SizeOf(typeof(Security)), inherit = 1 };
                input = CreateFileW("NUL", 0x80000000, 1, ref security, 3, 0, IntPtr.Zero); Need(input != new IntPtr(-1), "NULL_INPUT");
                Need(DuplicateHandle(GetCurrentProcess(), GetStdHandle(-11), GetCurrentProcess(), out output, 0, true, 2), "STDOUT_DUPLICATE");
                Need(DuplicateHandle(GetCurrentProcess(), GetStdHandle(-12), GetCurrentProcess(), out error, 0, true, 2), "STDERR_DUPLICATE");
                IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                if (size == IntPtr.Zero) throw new Exception("ATTRIBUTE_SIZE"); attributes = Marshal.AllocHGlobal(size);
                Need(InitializeProcThreadAttributeList(attributes, 1, 0, ref size), "ATTRIBUTES_CREATE");
                attributesInitialized = true;
                handleList = Marshal.AllocHGlobal(3 * IntPtr.Size); Marshal.WriteIntPtr(handleList, 0, input); Marshal.WriteIntPtr(handleList, IntPtr.Size, output); Marshal.WriteIntPtr(handleList, 2 * IntPtr.Size, error);
                Need(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handleList, new IntPtr(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "HANDLE_ALLOWLIST");
                Environment.SetEnvironmentVariable("GEPPIO_ISOLATION_DESKTOP", desktop);
                Environment.SetEnvironmentVariable("GEPPIO_TEST_VISIBLE", null);
                var startup = new StartupEx { startup = new Startup { size = Marshal.SizeOf(typeof(StartupEx)), desktop = "WinSta0\\" + desktop, flags = 0x100, input = input, output = output, error = error }, attributes = attributes };
                var command = new StringBuilder(Quote(node) + " --experimental-strip-types " + Quote(worker) + " " + Quote(request));
                Need(CreateProcessW(node, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080004, IntPtr.Zero, root, ref startup, out child), "WORKER_CREATE_SUSPENDED");
                Need(AssignProcessToJobObject(job, child.process), "JOB_ASSIGN_BEFORE_EXECUTION"); assigned = true;
                var watcher = new Thread(delegate() { try { Console.OpenStandardInput().ReadByte(); canceled.Set(); } catch { try { canceled.Set(); } catch (ObjectDisposedException) {} } }); watcher.IsBackground = true; watcher.Start();
                Console.WriteLine("{\"kind\":\"ready\",\"desktop\":\"" + desktop + "\"}");
                Need(ResumeThread(child.thread) != 0xffffffff, "WORKER_RESUME");
                var elapsed = Stopwatch.StartNew();
                while (WaitForSingleObject(child.process, 100) == 0x102) {
                    if (canceled.WaitOne(0)) { exit = 130; interrupted = true; break; }
                    if (elapsed.ElapsedMilliseconds >= timeout) { exit = 124; interrupted = true; break; }
                    MonitorInput(job, desktop);
                }
                if (!interrupted) { Need(WaitForSingleObject(child.process, 0) == 0, "WORKER_WAIT_FAILED"); Need(GetExitCodeProcess(child.process, out exit), "WORKER_EXIT_STATUS"); }
            } catch (Exception failure) { Console.Error.WriteLine("ISOLATION_REFUSED " + failure.Message + " win32=" + (failure is Win32Exception ? ((Win32Exception)failure).NativeErrorCode : 0)); exit = 125; }
            finally {
                try {
                    if (child.process != IntPtr.Zero && !assigned) { Need(TerminateProcess(child.process, 125), "SUSPENDED_CHILD_CLEANUP"); Need(WaitForSingleObject(child.process, 5000) == 0, "SUSPENDED_CHILD_EXIT"); }
                } catch (Exception failure) { cleanup = false; Console.Error.WriteLine("CLEANUP_FAILED " + failure.Message); }
                try {
                    if (job != IntPtr.Zero) { Need(TerminateJobObject(job, 125), "OWNED_JOB_TERMINATE"); var until = Stopwatch.StartNew(); while (Active(job) != 0 && until.ElapsedMilliseconds < 5000) Thread.Sleep(25); if (Active(job) != 0) throw new Exception("OWNED_PROCESSES_REMAIN"); }
                } catch (Exception failure) { cleanup = false; Console.Error.WriteLine("CLEANUP_FAILED " + failure.Message); }
                foreach (IntPtr handle in new[] { child.thread, child.process }) if (handle != IntPtr.Zero && !CloseHandle(handle)) { cleanup = false; Console.Error.WriteLine("CLEANUP_FAILED PROCESS_HANDLE_CLOSE"); }
                if (attributes != IntPtr.Zero) { if (attributesInitialized) DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); } if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
                foreach (IntPtr handle in new[] { input, output, error, job }) if (handle != IntPtr.Zero && handle != new IntPtr(-1)) if (!CloseHandle(handle)) { cleanup = false; Console.Error.WriteLine("CLEANUP_FAILED STANDARD_OR_JOB_HANDLE_CLOSE"); }
                if (desk != IntPtr.Zero) {
                    if (!CloseDesktop(desk)) { cleanup = false; Console.Error.WriteLine("CLEANUP_FAILED DESKTOP_CLOSE win32=" + Marshal.GetLastWin32Error()); }
                    // Forced process termination can defer Win32 GUI-object rundown. Wait only
                    // for this exact resource to disappear; never retry a suite or accept denial.
                    var releaseWait = Stopwatch.StartNew(); bool released = false;
                    while (releaseWait.ElapsedMilliseconds < 5000) {
                        IntPtr remaining = OpenDesktopW(desktop, 0, false, 1);
                        if (remaining == IntPtr.Zero) { if (Marshal.GetLastWin32Error() == 2) released = true; break; }
                        Need(CloseDesktop(remaining), "DESKTOP_RELEASE_PROBE_CLOSE"); Thread.Sleep(25);
                    }
                    if (!released) { cleanup = false; Console.Error.WriteLine("CLEANUP_FAILED DESKTOP_RELEASE_UNPROVEN"); }
                }
                if (acquired) mutex.ReleaseMutex();
            }
        }
        if (!cleanup && exit == 0) exit = 125;
        Console.WriteLine("{\"kind\":\"result\",\"exitCode\":" + exit + ",\"cleanup\":" + (cleanup ? "true" : "false") + "}"); return unchecked((int)exit);
    }
    public static int Main(string[] args) {
        try { if (args.Length == 3 && args[0] == "attest") return Attest(args[1], args[2]); if (args.Length == 4 && args[0] == "window") return AttestWindow(args[1], args[2], args[3]); if (args.Length == 2 && args[0] == "verify-absent") return VerifyAbsent(args[1]); if (args.Length > 0 && args[0] == "run") return Run(args); throw new Exception("BRIDGE_ARGUMENTS"); }
        catch (Exception failure) { Console.Error.WriteLine("ISOLATION_REFUSED " + failure.Message); return 125; }
    }
}
