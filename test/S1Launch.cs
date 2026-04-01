using System;
using System.Runtime.InteropServices;

class Program {
    [DllImport("kernel32.dll")] static extern uint WTSGetActiveConsoleSessionId();
    [DllImport("wtsapi32.dll", SetLastError=true)] static extern bool WTSQueryUserToken(uint s, out IntPtr t);
    [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr t, string a, string c, IntPtr sa, IntPtr ta, bool i, uint f, IntPtr e, string d, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("userenv.dll", SetLastError=true)] static extern bool CreateEnvironmentBlock(out IntPtr e, IntPtr t, bool i);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct STARTUPINFO { public int cb; public string r1, lpDesktop, t; public int x, y, w, h, xc, yc, fa, sf; public short sw, r2; public IntPtr r3, si, so, se; }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hp, ht; public int pid, tid; }

    static void Main(string[] args) {
        if (args.Length == 0) { Console.WriteLine("Usage: S1Launch.exe <exe> [args...]"); return; }
        string exe = args[0];
        string cmd = String.Join(" ", args);
        uint sid = WTSGetActiveConsoleSessionId();
        Console.WriteLine("Session: " + sid);
        IntPtr tok;
        if (!WTSQueryUserToken(sid, out tok)) { Console.WriteLine("Token fail: " + Marshal.GetLastWin32Error()); return; }
        IntPtr env; CreateEnvironmentBlock(out env, tok, false);
        var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.lpDesktop = "winsta0\x5Cdefault";
        PROCESS_INFORMATION pi;
        if (!CreateProcessAsUser(tok, exe, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x410, env, null, ref si, out pi)) {
            Console.WriteLine("Launch fail: " + Marshal.GetLastWin32Error()); CloseHandle(tok); return;
        }
        Console.WriteLine("PID: " + pi.pid);
        CloseHandle(pi.hp); CloseHandle(pi.ht); CloseHandle(tok);
    }
}
