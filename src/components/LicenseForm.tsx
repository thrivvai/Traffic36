import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { POLICY } from "../../shared/policy.ts";
import type { IdDocumentKind, LicenseDetails, Me } from "../../shared/types.ts";
import { US_LICENSE_STATES } from "../../shared/usStates.ts";
import { useAccount } from "../lib/account.tsx";
import { RequestError } from "../lib/api.ts";
import { prepareIdPhoto, type PhotoCheck } from "../lib/image.ts";
import { Icon } from "./Icon.tsx";
import { PhotoGuide } from "./PhotoGuide.tsx";

type Slot =
  | { state: "empty" }
  | { state: "working"; preview?: string }
  | { state: "ready"; preview: string; id: string; check: PhotoCheck }
  | { state: "error"; preview?: string; message: string; file?: File };

const SLOTS: { kind: IdDocumentKind; title: string; hint: string; capture: "environment" | "user" }[] = [
  { kind: "license_front", title: "Front of license", hint: "Flat on a dark surface, all four corners showing.", capture: "environment" },
  { kind: "license_back", title: "Back of license", hint: "Same as the front. Make sure the barcode is sharp.", capture: "environment" },
  { kind: "selfie", title: "Selfie with your license", hint: "Hold it next to your face, photo side out.", capture: "user" },
];

function PhotoSlot({ kind, title, hint, capture, slot, onPick, onRetry, invalid }: {
  kind: IdDocumentKind;
  title: string;
  hint: string;
  capture: "environment" | "user";
  slot: Slot;
  onPick: (file: File) => void;
  onRetry: () => void;
  invalid: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const preview = "preview" in slot ? slot.preview : undefined;
  const warnings =
    slot.state === "ready"
      ? [
          slot.check.dark && "This photo looks dark. Try brighter light.",
          slot.check.blurry && "This photo may be blurry. Hold still and retake it if the text isn't sharp.",
          slot.check.small && "This photo is small. Move closer so the license fills the frame.",
        ].filter((w): w is string => !!w)
      : [];

  return (
    <div className={`slot${invalid ? " invalid" : ""}${slot.state === "ready" ? " done" : ""}`}>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/*"
        capture={capture}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(f);
        }}
      />
      <div className="slot-media">
        {preview ? <img src={preview} alt={`Your ${title.toLowerCase()}`} /> : <Icon name={kind === "selfie" ? "user" : "id"} size={26} />}
        {slot.state === "working" && <span className="slot-busy"><span className="spinner" aria-hidden="true" />Uploading</span>}
        {slot.state === "ready" && <span className="slot-ok"><Icon name="check" size={14} />Uploaded</span>}
      </div>
      <div className="slot-body">
        <b>{title}</b>
        <span>{hint}</span>
        {warnings.map((w) => <span key={w} className="slot-warn"><Icon name="alert" size={13} />{w}</span>)}
        {slot.state === "error" && (
          <span className="slot-err" role="alert"><Icon name="alert" size={13} />{slot.message}</span>
        )}
        <div className="slot-actions">
          {slot.state === "error" && slot.file && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button>}
          <label htmlFor={id} className={`btn btn-sm ${slot.state === "empty" ? "btn-heat" : "btn-ghost"}`}>
            <Icon name="upload" size={14} />
            {slot.state === "empty" ? "Take photo" : "Retake"}
          </label>
        </div>
      </div>
    </div>
  );
}

/**
 * The renter's driver's license, checked by the host. Each photo uploads as soon as it's taken,
 * so the final "Send" only has to carry the typed details.
 */
export function LicenseForm({ me }: { me: Me }) {
  const account = useAccount();
  const [slots, setSlots] = useState<Record<IdDocumentKind, Slot>>({
    license_front: { state: "empty" },
    license_back: { state: "empty" },
    selfie: { state: "empty" },
  });
  const [details, setDetails] = useState<LicenseDetails>({
    legalName: me.identity.name ?? me.name ?? "",
    dob: "",
    licenseState: me.identity.licenseState ?? "GA",
    licenseExpiresOn: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const put = (kind: IdDocumentKind, slot: Slot) => setSlots((s) => ({ ...s, [kind]: slot }));

  const pick = async (kind: IdDocumentKind, raw: File) => {
    if (error?.field === kind) setError(null);
    put(kind, { state: "working" });
    let prepared: Awaited<ReturnType<typeof prepareIdPhoto>>;
    try {
      prepared = await prepareIdPhoto(raw);
    } catch (err) {
      put(kind, { state: "error", message: (err as Error).message });
      return;
    }
    const preview = URL.createObjectURL(prepared.file);
    previews.current.push(preview);
    put(kind, { state: "working", preview });
    try {
      const { id } = await account.api.uploadIdPhoto(kind, prepared.file);
      put(kind, { state: "ready", preview, id, check: prepared.check });
    } catch (err) {
      put(kind, { state: "error", preview, message: (err as Error).message, file: raw });
    }
  };

  const set = (k: keyof LicenseDetails) => (e: { target: { value: string } }) => {
    setDetails((d) => ({ ...d, [k]: e.target.value }));
    if (error?.field === k) setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const missing = SLOTS.find((s) => slots[s.kind].state !== "ready");
    if (missing) {
      setError({ message: `Add the ${missing.title.toLowerCase()} first.`, field: missing.kind });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ids = Object.fromEntries(SLOTS.map((s) => [s.kind, (slots[s.kind] as { id: string }).id])) as Record<IdDocumentKind, string>;
      account.setMe(await account.api.submitLicense(details, ids));
    } catch (err) {
      setError({ message: (err as Error).message, field: err instanceof RequestError ? err.field : undefined });
      setBusy(false);
    }
  };

  const invalid = (f: string) => `field${error?.field === f ? " invalid" : ""}`;
  const allUploaded = SLOTS.every((s) => slots[s.kind].state === "ready");

  return (
    <form className="licenseform" onSubmit={submit} noValidate>
      <PhotoGuide />
      <div className="slots">
        {SLOTS.map((s) => {
          const slot = slots[s.kind];
          return (
            <PhotoSlot
              key={s.kind}
              {...s}
              slot={slot}
              invalid={error?.field === s.kind}
              onPick={(f) => void pick(s.kind, f)}
              onRetry={() => slot.state === "error" && slot.file && void pick(s.kind, slot.file)}
            />
          );
        })}
      </div>

      <fieldset className="lf-details">
        <legend>Details exactly as printed on your license</legend>
        <div className={`${invalid("legalName")} span2`}>
          <label htmlFor="lf-name">Full legal name</label>
          <input id="lf-name" className="input" autoComplete="name" value={details.legalName} onChange={set("legalName")} maxLength={120} />
        </div>
        <div className={invalid("dob")}>
          <label htmlFor="lf-dob">Date of birth</label>
          <input id="lf-dob" className="input" type="date" autoComplete="bday" value={details.dob} onChange={set("dob")} />
        </div>
        <div className={invalid("licenseState")}>
          <label htmlFor="lf-state">Issuing state</label>
          <select id="lf-state" className="select" value={details.licenseState} onChange={set("licenseState")}>
            {Object.entries(US_LICENSE_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </div>
        <div className={invalid("licenseExpiresOn")}>
          <label htmlFor="lf-exp">Expiration date</label>
          <input id="lf-exp" className="input" type="date" value={details.licenseExpiresOn} onChange={set("licenseExpiresOn")} />
        </div>
      </fieldset>

      <p className="fine left">
        Renters must be {POLICY.minAgeFloor} or older. Your license photos are private: only Traffic36 can see them, and we use them only to check who's driving.
      </p>
      {error && <div className="note bad" role="alert"><Icon name="alert" size={16} /><span>{error.message}</span></div>}
      <button className="btn btn-heat btn-block" type="submit" disabled={busy} style={{ marginTop: 14 }}>
        {busy ? "Sending…" : allUploaded ? "Send my license" : "Add all three photos to continue"}
      </button>
    </form>
  );
}
