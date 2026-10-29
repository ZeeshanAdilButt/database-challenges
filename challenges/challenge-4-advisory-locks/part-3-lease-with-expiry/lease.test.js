// A live lease turns others away; an expired one can be taken over; and
// only the fencing token stops the late old owner from overwriting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DATABASES, skipUnless } from "../../../toolkit/db.js";
import { story } from "./lease.js";

for (const kind of DATABASES) {
  const skip = await skipUnless(kind);

  test(`${kind}: B waits for the lease to run out, then takes over`, { skip }, async () => {
    const { steps } = await story(kind, { fenced: true });
    assert.match(steps[3].result, /^refused/);
    assert.match(steps[4].result, /got it, token 2/);
  });

  test(`${kind}: without a fence, late A overwrites B`, { skip }, async () => {
    const { final } = await story(kind, { fenced: false });
    assert.equal(final.claimed_by, "A");
  });

  test(`${kind}: with a fence, late A is turned away and B finishes`, { skip }, async () => {
    const { steps, final } = await story(kind, { fenced: true });
    assert.match(steps[5].result, /fenced out/);
    assert.equal(final.claimed_by, "B");
    assert.equal(final.status, "done");
  });
}
