# Checksum

`checksum.json` uses SHA-256 per file. The implementation uses Web Crypto API and verifies each listed file during import.

`package_hash_sha256` is reserved for future whole-package hashing. It is not currently populated because zip container bytes change when `checksum.json` is inserted.

Hash mismatch, missing required files, or checksum format errors block installation.
