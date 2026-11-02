# windows xp

Windows XP Professional SP3, booted from its ISO on this machine by QEMU.

The same machine as `templeos`, and for the same reason: no browser emulator is
small enough and capable enough to boot it. XP predates the era of "just put it
in a tab" by a decade.

## Running it

```
open http://ayamai.local/gemu/system/windowsxp/
```

The first press creates a sparse 8 GB disk in the vault (`system/windows-xp.qcow2`)
and boots the installer. The ISO is a volume-licence copy: it asks for a key
before it will install, and the install takes about half an hour. To play from the
CD without installing, answer the setup prompt and leave the disk alone.

Nothing is shared: the disk is a file in the vault, and deleting it returns the
machine to a fresh install.

## Licensing

The ISO and the disk are the owner's, kept in the vault, never in the repository
and never published. Windows XP is proprietary; the emulated machine is not a
licence grant.
