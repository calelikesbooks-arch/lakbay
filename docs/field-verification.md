# Field verification

Field checks are how LAKBAY records become **verified** and appear on the
public map. A moderator goes to the place (or rides the route), opens
`/field` on their phone, and records what they found.

```
import ──▶ draft (Data review) ──▶ field check on site ──▶ verified (public)
                                                    └──▶ needs re-check / retired
```

## What each answer does

### Terminals and stops ("Places near me")

| Answer | Needs | Result |
| --- | --- | --- |
| **It's here** | GPS ±35 m (stop) / ±60 m (terminal), and you within *accuracy + 30 m* (stop) / *+120 m* (terminal) of the pin | **Verified**. Re-check due in 180 days. |
| **It's here, but the pin is wrong** | Same GPS accuracy; you stand at the real spot (less than 500 m away) | Location replaced by your GPS point, then **verified**. |
| **Not found** | GPS at the pin + a note | Draft: only logged (one visit doesn't delete anything). Public record: **needs re-check**. |
| **Closed / no longer used** | A note | **Retired** (hidden). |
| **Not sure** | A note | Only logged. |

Coordinates are never typed. A confirmation always uses a fresh phone GPS
fix (no cached positions).

### Routes ("Ride a route")

| Answer | Needs | Result |
| --- | --- | --- |
| **I rode it** | Boarding and alighting stops of that route, in the right order | Variant **verified** (and its route, if not yet). Re-check due in 90 days. |
| + fare paid | optional | Saved as an **observation** ("one ride, not an official fare"). No fare rule is created. |
| + "line matches" = yes | optional | The route line on the map is verified too. "No" or "didn't check" leaves the line unverified. |
| + signboard | optional | Saved as evidence; filled into the variant if it had none. |
| **Not running here / stopped operating / not sure** | A note | Same as places: logged, needs re-check, or retired (only that variant). |

The result screen lists stops of the route that are still unverified, so
you can check them too.

## What becomes public

| Public (once the record is verified) | Private (moderators only) |
| --- | --- |
| The record and its status | Your exact GPS position and accuracy |
| A source "LAKBAY field check: name (date)" | Your notes |
| Evidence lines (seen on site, sign text, observed fare) | Who did which check (`field_checks`) |

Don't write names or details of people in signboard fields: those are public.

## Install

1. Supabase SQL Editor: run `supabase/migrations/20261121000800_field_verification.sql`.
2. Run `supabase/tests/security_test.sql`. Expected: **ALL 40 SECURITY TESTS PASSED**.
3. Push the app code. Open `https://<your site>/field` on your phone (it must be
   https for GPS), sign in with a moderator/admin account.

## Testing on a real phone

1. Promote one candidate near you in Data review (it becomes a draft).
2. Go there, open `/field` → **Get my position**. Wait until accuracy is good,
   then tap **Use this**.
3. **Find places to check** → pick it → **It's here** → Save.
4. The result should say *Draft → Verified*, and the place appears on the public map.
5. Try "It's here" from about 200 m away: it must be refused.

## Settings

The limits are in `private.field_rules()` in the migration (accuracy,
tolerance, max move, 14-day entry limit, review intervals). The app's
`src/lib/field/checks.ts` mirrors them for early warnings; the database is
what enforces them.

## Not included (yet)

- **Photos.** Supabase Storage needs its own policies; planned later
  (`sources.storage_path` is ready for it).
- **Offline saving.** You need mobile data when you tap Save.
- **GPS traces of rides.** The line is confirmed by eye ("matches"), not recorded.
