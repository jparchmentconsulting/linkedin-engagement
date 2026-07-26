import "server-only";
import { db } from "./db";

// Hard, irreversible deletion of one scraped person and every row that holds
// their data. Dismiss/snooze only hide a lead; this deletes them. Ordering
// matters: EngagementEvent carries a foreign key to Person, so it goes
// first. Wrapped in a transaction so a person is never left half-deleted. The pipeline reuses this to remove the account owner if they
// slip into their own lead list, so the "what does it take to fully remove a
// person" logic lives in exactly one place.
export async function erasePerson(personId: string): Promise<void> {
  await db.$transaction([
    db.engagementEvent.deleteMany({ where: { personId } }),
    db.person.delete({ where: { id: personId } }),
  ]);
}
