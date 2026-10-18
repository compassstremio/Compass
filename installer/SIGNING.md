# Signing the Windows installers

Two different signatures exist. Do not confuse them.

| Signature | What it is for | Status |
|---|---|---|
| **minisign** (`.sig` files) | The in-app updater verifies it against the public key in `src-tauri/tauri.conf.json`. | Always applied by `scripts/release-beta.ps1`. Never change the key pair. |
| **Authenticode** | Windows SmartScreen and the file's "Digital Signatures" tab. | **Not available yet** (no certificate). Optional step in `release-beta.ps1`. |

Without Authenticode, a first-time download of `Compass_<ver>_x64-installer.exe` shows
"Windows protected your PC". Existing users updating from inside the app are not affected.

## Turning it on

Install a code-signing certificate in the Windows certificate store (a hardware token also works), then:

    $env:COMPASS_SIGN_THUMBPRINT = '<certificate SHA-1 thumbprint>'
    # optional
    $env:COMPASS_SIGNTOOL = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe'
    $env:COMPASS_SIGN_TIMESTAMP = 'http://timestamp.digicert.com'
    pwsh -File scripts/release-beta.ps1

The script signs both staged installers with SHA-256 and a trusted timestamp, verifies them with
`signtool verify /pa`, and only then applies the minisign signatures. No secret is passed on a command line.

## Where to get a certificate

- **Azure Trusted Signing**: low monthly price, builds reputation quickly; needs an Azure account and identity validation.
- **OV code-signing certificate**: cheaper; SmartScreen reputation builds slowly with downloads.
- **EV code-signing certificate**: highest cost, immediate SmartScreen trust, delivered on a hardware token.

Azure Trusted Signing signs through its own `signtool` plug-in and does not use a thumbprint; if you choose it,
replace the `signtool sign` arguments in the "Authenticode (optional)" step accordingly.

## Limits

The executables inside the payload (`compass.exe`, `mpv.exe`, ...) are not Authenticode-signed by this step; only the
two installers are. Signing the payload files would change `payloadVersion` verification and needs its own change.
