import { useState } from "react";
import { Icon, useToast } from "./ui";
import { ContactsPhoneForm, useMyPhoneSet } from "./ContactsPhone";

/** "Phone number for friend matching" setting on the Me page. */
export function MePhoneRow() {
  const toast = useToast();
  const phone = useMyPhoneSet();
  const [editing, setEditing] = useState(false);

  return (
    <section className="card soft" aria-labelledby="me-phone-h">
      <div className="row">
        <Icon name="people" color="var(--green)" />
        <div className="grow stack tight">
          <span id="me-phone-h" className="strong">Phone number for friend matching</span>
          <span className="tiny muted">
            {phone.error ? "Couldn't check" : phone.isSet === undefined ? "Checking…" : phone.isSet ? "Set. Friends with your number can find you." : "Not set. Friends can't find you by number."}
          </span>
        </div>
        {phone.error ? (
          <button type="button" className="link-btn strong" onClick={phone.reload}>Retry</button>
        ) : phone.isSet !== undefined && !editing ? (
          <button type="button" className="btn small ghost" onClick={() => setEditing(true)}>
            {phone.isSet ? "Change" : "Add"}
          </button>
        ) : null}
      </div>
      {editing && (
        <ContactsPhoneForm
          allowRemove={Boolean(phone.isSet)}
          cancelLabel="Cancel"
          onCancel={() => setEditing(false)}
          onSaved={(v) => { phone.setIsSet(v); setEditing(false); toast(v ? "Number saved" : "Number removed"); }}
        />
      )}
    </section>
  );
}
