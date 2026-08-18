using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;

internal static class Program
{
    private const int ErrorExitCode = 1;
    private const int UsageExitCode = 2;
    private const int CryptProtectUiForbidden = 0x1;
    private static readonly Regex CredentialIdPattern = new(
        "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
        RegexOptions.CultureInvariant);

    private static int Main(string[] args)
    {
        if (!TryParseArguments(args, out var credentialId, out var dataDirectory))
        {
            Console.Error.WriteLine("Usage: omp-switch-secret --secret-get <credential-id> [--data-dir <path>]");
            return UsageExitCode;
        }

        try
        {
            var secret = ReadSecret(credentialId, dataDirectory);
            Console.Out.WriteLine(secret);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return ErrorExitCode;
        }
    }

    private static bool TryParseArguments(string[] args, out string credentialId, out string dataDirectory)
    {
        credentialId = string.Empty;
        dataDirectory = Environment.GetEnvironmentVariable("OMP_SWITCH_DATA_DIR")?.Trim()
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "omp-switch");

        if (args.Length < 2 || args[0] != "--secret-get" || !CredentialIdPattern.IsMatch(args[1])) return false;
        credentialId = args[1];
        if (args.Length == 2) return true;
        if (args.Length == 4 && args[2] == "--data-dir" && !string.IsNullOrWhiteSpace(args[3]))
        {
            dataDirectory = args[3];
            return true;
        }
        return false;
    }

    private static string ReadSecret(string credentialId, string dataDirectory)
    {
        var vaultPath = Path.Combine(dataDirectory, "secrets.v1.json");
        var localStatePath = Path.Combine(dataDirectory, "Local State");
        if (!File.Exists(vaultPath)) throw new InvalidOperationException("Credential vault was not found");
        if (!File.Exists(localStatePath)) throw new InvalidOperationException("Credential encryption state was not found");

        using var vault = JsonDocument.Parse(File.ReadAllText(vaultPath));
        if (!vault.RootElement.TryGetProperty("entries", out var entries)
            || !entries.TryGetProperty(credentialId, out var entry)
            || !entry.TryGetProperty("ciphertext", out var ciphertextProperty)
            || string.IsNullOrWhiteSpace(ciphertextProperty.GetString()))
        {
            throw new InvalidOperationException($"Credential not found: {credentialId}");
        }

        return Decrypt(ciphertextProperty.GetString()!, localStatePath);
    }

    private static string Decrypt(string ciphertextBase64, string localStatePath)
    {
        var encrypted = Convert.FromBase64String(ciphertextBase64);
        if (encrypted.Length >= 3 && (encrypted.AsSpan(0, 3).SequenceEqual("v10"u8) || encrypted.AsSpan(0, 3).SequenceEqual("v11"u8)))
        {
            var encryptionKey = ReadEncryptionKey(localStatePath);
            try
            {
                const int prefixLength = 3;
                const int nonceLength = 12;
                const int tagLength = 16;
                var encryptedPayloadLength = encrypted.Length - prefixLength - nonceLength - tagLength;
                if (encryptedPayloadLength < 0) throw new InvalidOperationException("Credential ciphertext is malformed");

                var plaintext = new byte[encryptedPayloadLength];
                try
                {
                    using var aes = new AesGcm(encryptionKey, tagLength);
                    aes.Decrypt(
                        encrypted.AsSpan(prefixLength, nonceLength),
                        encrypted.AsSpan(prefixLength + nonceLength, encryptedPayloadLength),
                        encrypted.AsSpan(prefixLength + nonceLength + encryptedPayloadLength, tagLength),
                        plaintext);
                    return Encoding.UTF8.GetString(plaintext);
                }
                finally
                {
                    CryptographicOperations.ZeroMemory(plaintext);
                }
            }
            finally
            {
                CryptographicOperations.ZeroMemory(encryptionKey);
            }
        }

        var unprotected = UnprotectWithDpapi(encrypted);
        try
        {
            return Encoding.UTF8.GetString(unprotected);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(unprotected);
        }
    }

    private static byte[] ReadEncryptionKey(string localStatePath)
    {
        using var localState = JsonDocument.Parse(File.ReadAllText(localStatePath));
        if (!localState.RootElement.TryGetProperty("os_crypt", out var osCrypt)
            || !osCrypt.TryGetProperty("encrypted_key", out var encryptedKeyProperty)
            || string.IsNullOrWhiteSpace(encryptedKeyProperty.GetString()))
        {
            throw new InvalidOperationException("Credential encryption key was not found");
        }

        var encryptedKey = Convert.FromBase64String(encryptedKeyProperty.GetString()!);
        var dpapiPrefix = "DPAPI"u8;
        if (!encryptedKey.AsSpan().StartsWith(dpapiPrefix))
        {
            throw new InvalidOperationException("Credential encryption key format is unsupported");
        }

        return UnprotectWithDpapi(encryptedKey[dpapiPrefix.Length..]);
    }

    private static byte[] UnprotectWithDpapi(byte[] encrypted)
    {
        var input = DataBlob.FromBytes(encrypted);
        DataBlob output = default;
        try
        {
            if (!CryptUnprotectData(ref input, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CryptProtectUiForbidden, out output))
            {
                throw new CryptographicException(Marshal.GetLastWin32Error());
            }

            return output.ToBytes();
        }
        finally
        {
            input.Dispose();
            output.Dispose();
        }
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DataBlob dataIn,
        StringBuilder? description,
        IntPtr optionalEntropy,
        IntPtr reserved,
        IntPtr promptStruct,
        int flags,
        out DataBlob dataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr memory);

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int Size;
        public IntPtr Data;

        public static DataBlob FromBytes(byte[] value)
        {
            var data = Marshal.AllocHGlobal(value.Length);
            Marshal.Copy(value, 0, data, value.Length);
            return new DataBlob { Size = value.Length, Data = data };
        }

        public readonly byte[] ToBytes()
        {
            if (Size <= 0 || Data == IntPtr.Zero) return [];
            var value = new byte[Size];
            Marshal.Copy(Data, value, 0, Size);
            return value;
        }

        public void Dispose()
        {
            if (Data == IntPtr.Zero) return;
            if (LocalFree(Data) != IntPtr.Zero) Marshal.FreeHGlobal(Data);
            Data = IntPtr.Zero;
            Size = 0;
        }
    }
}
