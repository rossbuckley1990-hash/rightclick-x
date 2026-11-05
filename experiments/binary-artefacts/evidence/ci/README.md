# CI evidence: the `ocsptool` development case on macOS

These are the complete logs of the four macOS jobs that ran the `ocsptool` development case before
its fixture was corrected. They are kept here because GitHub deletes Actions logs after its
retention period. The other eight jobs of the same runs (Linux, package) passed, and they either
skipped this case or don't run it.

| Head | Workflow | Job | Conclusion | Log (SHA-256) |
|---|---|---|---|---|
| `598d025` | product-ci | [verify (macos-15)](https://github.com/rossbuckley1990-hash/rightclick-x/actions/runs/41989913452/job/127119408988) | failure | [598d025-product-ci-verify-macos-15-failure-job127119408988.txt](598d025-product-ci-verify-macos-15-failure-job127119408988.txt) (`fd36502d09a4d24023d1db7add19f011e3a1fbbf47b71910d49d077dd3c6507f`) |
| `598d025` | ci | [macos](https://github.com/rossbuckley1990-hash/rightclick-x/actions/runs/41989913510/job/127119409191) | failure | [598d025-ci-macos-failure-job127119409191.txt](598d025-ci-macos-failure-job127119409191.txt) (`c20a9006fe514d6a9c1eac669a9161738d3ceb35da5bf02d8cc7d327239e9fd4`) |
| `797a92d` | product-ci | [verify (macos-15)](https://github.com/rossbuckley1990-hash/rightclick-x/actions/runs/41990833972/job/127122407764) | success, through the diagnostic branch | [797a92d-product-ci-verify-macos-15-success-job127122407764.txt](797a92d-product-ci-verify-macos-15-success-job127122407764.txt) (`baf62f12047fd4f3ae2e275769cf18768e7f7094bd919bee32bf65c324931a5e`) |
| `797a92d` | ci | [macos](https://github.com/rossbuckley1990-hash/rightclick-x/actions/runs/41990834155/job/127122408863) | success, through the diagnostic branch | [797a92d-ci-macos-success-job127122408863.txt](797a92d-ci-macos-success-job127122408863.txt) (`ef9435ff2a0b859fc5f25b96d82a8f2ab98630caac7d5df504dff10ca7098a23`) |

The logs were saved with `gh run view <run> --job <job> --log`; each line carries the job and step
name.

## What the logs show

- **`598d025`:** in both jobs, `development case ocsptool` was the only failure (816 other tests
  passed). `ocsptool` printed the response details but no `Verifying OCSP Response` line.
- **`797a92d`:** both jobs passed, but only through the test's diagnostic branch, which reported
  `error parsing CAs: Duplicate extension in X.509 certificate.` from `ocsptool 3.8.13`. **Those
  green checks did not show that a signature was verified.**

## Cause: the fixture, not RightClick and not `ocsptool`

- **The runner's OpenSSL.** The `macos-15-arm64` image (`20261028.0489`) links Homebrew
  `openssl@1.1`, OpenSSL 1.1.1w, at `/opt/homebrew/bin/openssl` (`install-openssl.sh` in
  `actions/runner-images` at that tag). The test takes its fixture tool from that path.
- **The duplicate.** The old fixture made its CAs with `req -x509 … -addext
  basicConstraints=critical,CA:TRUE`. In OpenSSL 1.1.1, `-addext` doesn't replace the default
  config's `v3_ca` `basicConstraints`, so the certificate carried the extension twice.
- **Why it's invalid.** RFC 5280 §4.2 forbids repeating an extension. GnuTLS refused the CA, so
  no signature was ever checked.
- **A wrong earlier explanation.** `ocsptool` is the same version (3.8.13) on the runner and
  locally. The explanation in `797a92d`'s commit message, "the host program's verdict", was wrong.

The old recipe, reproduced with OpenSSL 1.1.1w (`debian:bullseye-slim`, package `1.1.1w-0+deb11u8`
from snapshot.debian.org) and inspected by tools that share no code with OpenSSL:

| Generator | Go `encoding/asn1` walk ([inspect-x509.go](inspect-x509.go)) | Go `crypto/x509` | GnuTLS 3.8.13 `certtool -i` |
|---|---|---|---|
| OpenSSL 1.1.1w | 2.5.29.14, 2.5.29.35, **2.5.29.19, 2.5.29.19**, 2.5.29.15 | `certificate contains duplicate extension with OID "2.5.29.19"` | `Duplicate extension in X.509 certificate.` |
| OpenSSL 3.6.5 | 2.5.29.14, 2.5.29.35, 2.5.29.19, 2.5.29.15 | parsed | parsed |
| OpenSSL 4.0.3 | 2.5.29.14, 2.5.29.19, 2.5.29.15 | parsed | parsed |

## Correction (test only, no production change)

The fixture now takes its extensions only from an explicit config section, never `-addext`, and
generates keys with `ecparam`. The test checks every fixture certificate before using it, with
its own DER walk (no OpenSSL or GnuTLS code). Each must be X.509 v3, must carry Basic Constraints,
and must not repeat an extension. A separate test confirms that walk finds the duplicate in the
1.1.1w certificate above.

The corrected recipe was run under four generators. The certificates were inspected as above, and
the host's `ocsptool 3.8.13` was run on each response directly:

| Generator | Certificates | Issuing CA | Unrelated CA |
|---|---|---|---|
| OpenSSL 1.1.1w | v3, no duplicates | exit 0, `Verifying OCSP Response: Success.` | exit 1, `Failure, Signer cert is not trusted.` |
| OpenSSL 3.6.5 | v3, no duplicates | exit 0, `Success.` | exit 1, `Failure, Signer cert is not trusted.` |
| OpenSSL 4.0.3 | v3, no duplicates | exit 0, `Success.` | exit 1, `Failure, Signer cert is not trusted.` |
| LibreSSL 3.3.6 | v3, no duplicates | exit 0, `Success.` | exit 1, `Failure, Signer cert is not trusted.` |

The single development test is now two, so a green transport result can no longer stand in for
verification:

- **Transport:** wherever `ocsptool` runs, the consumed input digests equal the staged bytes, and
  the exit code and stdout bytes equal those of a direct sandbox run.
- **Verification:**
  - **Support:** decided from the program's documented options (`-e`, `--infile`,
    `--load-trust`) before anything runs. A program without them gets an explicit
    `unsupported` skip.
  - **Issuing CA:** must verify (exit 0, `Success`).
  - **Unrelated CA:** must produce a `Failure` verdict from the signature check. A parse error
    also exits non-zero, but it prints no verdict, so it doesn't count as a failed signature.
