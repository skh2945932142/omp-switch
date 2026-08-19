using System.Diagnostics;

internal static class Program
{
    private const int UsageExitCode = 2;

    private static async Task<int> Main(string[] args)
    {
        var forwardedArguments = args.Length > 0 && args[0] == "--json" ? args[1..] : args;
        if (forwardedArguments.Length == 0)
        {
            await Console.Error.WriteLineAsync("Usage: omp-switch-cli <list|get|validate|apply|snapshot> [options]");
            return UsageExitCode;
        }

        var appPath = Path.Combine(AppContext.BaseDirectory, "OMP Switch.exe");
        if (!File.Exists(appPath))
        {
            await Console.Error.WriteLineAsync("OMP Switch.exe was not found next to omp-switch-cli.exe");
            return UsageExitCode;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = appPath,
            WorkingDirectory = AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add("--json");
        foreach (var argument in forwardedArguments) startInfo.ArgumentList.Add(argument);

        try
        {
            using var process = new Process { StartInfo = startInfo };
            if (!process.Start())
            {
                await Console.Error.WriteLineAsync("Unable to start OMP Switch.exe");
                return UsageExitCode;
            }

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            if (!string.IsNullOrEmpty(stdout)) await Console.Out.WriteAsync(stdout);
            if (!string.IsNullOrEmpty(stderr)) await Console.Error.WriteAsync(stderr);
            return process.ExitCode;
        }
        catch (Exception error)
        {
            await Console.Error.WriteLineAsync(error.Message);
            return UsageExitCode;
        }
    }
}
