# Review-only SQL

Nothing under this directory is an active migration or permission to change a
database. Preserve the original Mahjong drafts until the product stage corrects
the blockers linked from [KNOWN_ISSUES.md](../../docs/operations/KNOWN_ISSUES.md).

## Mahjong drafts

The three original files now live in `mahjong-clash/`. They were moved unchanged
from `migrations/` to prevent accidental bulk application. They remain incomplete;
moving them does not approve their design or deploy them.

The approved platform SQL is now in ../migrations/ and has been applied. This
directory contains only unapproved product drafts; never include them in a bulk
push. Current deployment and verification are owned by [README.md](../../README.md).
