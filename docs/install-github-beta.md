# Install The GitHub Beta

The GitHub beta is an unpacked Chrome extension. It does not update
automatically; replace the extracted folder when a newer beta is published.

## Download And Verify

1. Open the repository's
   [Releases page](https://github.com/ChristFollower873461/sleeper-draft-command-center/releases)
   and choose the newest prerelease.
2. Download the versioned `.zip` and matching `.zip.sha256` file.
3. Put both files in the same folder.
4. Verify the checksum.

macOS or Linux:

```bash
shasum -a 256 -c sleeper-draft-command-center-*.zip.sha256
```

Windows PowerShell:

```powershell
Get-FileHash .\sleeper-draft-command-center-*.zip -Algorithm SHA256
```

Compare the PowerShell value with the first value in the checksum file.

## Load In Chrome

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select the extracted folder containing `manifest.json`.
6. Pin Sleeper Draft Command Center from Chrome's Extensions menu.

Chrome removes access if the extracted folder is moved or deleted.

## First Draft

1. Open the extension and enter a public Sleeper username.
2. Build a public starter board, paste a list, or import JSON or CSV.
3. Resolve flagged player identities and save the profile.
4. Open a discovered Sleeper draft or start a manual room.

The extension reads public Sleeper data and stores rankings locally. It never
submits a Sleeper pick.

## Update Or Roll Back

For an update, extract the new ZIP to a new folder, choose Reload on
`chrome://extensions`, and use Load unpacked if Chrome still points to the old
folder. Local rankings remain in extension storage when the extension ID is
unchanged.

For rollback, restore the previous extracted release folder and reload the
extension. Keep exported ranking packs as an additional portable backup.
