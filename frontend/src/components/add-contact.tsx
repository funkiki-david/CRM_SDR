/**
 * Add Contact Modal — Create a new contact with full validation
 * Spec: docs/CONTACTS-ENHANCEMENT-SPEC.md, Section 2
 *
 * Features:
 *   - Field validation with inline error messages
 *   - Email dedup check with 3 resolution options
 *   - Cancel with unsaved changes confirmation
 *   - Success toast + auto-select new contact
 */
"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { contactsApi } from "@/lib/api";

interface AddContactProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (contactId: number) => void;
}

// Field validation errors
interface FieldErrors {
  first_name?: string;
  last_name?: string;
  email?: string;
  mobile_phone?: string;
  office_phone?: string;
  linkedin_url?: string;
  industry_tags?: string;
  notes?: string;
}

// Dedup state
interface DedupInfo {
  existing_contact_id: number;
  existing_name: string;
  existing_title: string | null;
  existing_company: string | null;
  last_activity_date: string | null;
}

export default function AddContact({ open, onClose, onSuccess }: AddContactProps) {
  // Form fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [officePhone, setOfficePhone] = useState("");
  const [title, setTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [website, setWebsite] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState("");

  // UI state
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Dedup state
  const [dedupInfo, setDedupInfo] = useState<DedupInfo | null>(null);
  const [dedupChoice, setDedupChoice] = useState<"view" | "update" | "duplicate">("view");

  // Discard confirmation
  const [showDiscard, setShowDiscard] = useState(false);

  function resetForm() {
    setFirstName(""); setLastName(""); setEmail("");
    setMobilePhone(""); setOfficePhone("");
    setTitle(""); setCompanyName(""); setCity(""); setState(""); setLinkedinUrl(""); setWebsite("");
    setTags([]); setTagInput(""); setNotes("");
    setErrors({}); setSaving(false); setSaved(false);
    setServerError(""); setIsDirty(false);
    setDedupInfo(null); setShowDiscard(false);
  }

  function markDirty() { setIsDirty(true); }

  // === Validation ===
  function validate(): boolean {
    const errs: FieldErrors = {};

    if (!firstName.trim()) errs.first_name = "Please enter a first name";
    if (!lastName.trim()) errs.last_name = "Please enter a last name";
    if (!email.trim()) {
      errs.email = "Please enter a valid email";
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      errs.email = "Please enter a valid email (like name@company.com)";
    }
    const phoneRe = /^[\d\s+\-().x]+$/;
    if (mobilePhone.trim() && !phoneRe.test(mobilePhone.trim())) {
      errs.mobile_phone = "Mobile phone can only contain numbers and +-().x";
    }
    if (officePhone.trim() && !phoneRe.test(officePhone.trim())) {
      errs.office_phone = "Office phone can only contain numbers and +-().x";
    }
    if (linkedinUrl.trim() && !linkedinUrl.toLowerCase().includes("linkedin.com")) {
      errs.linkedin_url = "Must be a LinkedIn URL (contains linkedin.com)";
    }
    if (tags.length > 10) errs.industry_tags = "Maximum 10 tags";
    if (notes.length > 2000) errs.notes = "Notes too long (max 2000 chars)";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const canSave = firstName.trim() && lastName.trim() && email.trim();

  // === Tag handling ===
  function addTag() {
    const t = tagInput.trim().slice(0, 30);
    if (!t || tags.includes(t)) { setTagInput(""); return; }
    if (tags.length >= 10) {
      setErrors(prev => ({ ...prev, industry_tags: "Maximum 10 tags" }));
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
    markDirty();
  }

  function removeTag(tag: string) {
    setTags(tags.filter(t => t !== tag));
    setErrors(prev => ({ ...prev, industry_tags: undefined }));
    markDirty();
  }

  // === Submit ===
  async function handleSave(forceCreate = false) {
    if (!validate()) return;

    setSaving(true);
    setServerError("");

    const data = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      mobile_phone: mobilePhone.trim() || null,
      office_phone: officePhone.trim() || null,
      title: title.trim() || null,
      company_name: companyName.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      linkedin_url: linkedinUrl.trim() || null,
      website: website.trim() || null,
      industry_tags: tags.length > 0 ? tags : null,
      notes: notes.trim() || null,
    };

    try {
      const result = await contactsApi.create(data, forceCreate);
      setSaved(true);
      setTimeout(() => {
        onSuccess?.(result.id);
        resetForm();
        onClose();
      }, 500);
    } catch (err: unknown) {
      // Check for dedup conflict (409)
      const errMsg = err instanceof Error ? err.message : "";
      if (errMsg.includes("Email already exists")) {
        // Try to parse the structured error
        try {
          // The error detail is in the message for 409
          const resp = await contactsApi.checkEmail(email.trim());
          if (resp.exists && resp.existing_contact) {
            setDedupInfo({
              existing_contact_id: resp.existing_contact.id,
              existing_name: `${resp.existing_contact.first_name} ${resp.existing_contact.last_name}`,
              existing_title: resp.existing_contact.title,
              existing_company: resp.existing_contact.company_name,
              last_activity_date: resp.last_activity_date,
            });
          }
        } catch {
          setServerError(errMsg);
        }
      } else {
        setServerError(errMsg || "Something went wrong.");
      }
    } finally {
      setSaving(false);
    }
  }

  // === Dedup resolution ===
  async function handleDedupContinue() {
    if (!dedupInfo) return;

    if (dedupChoice === "view") {
      onSuccess?.(dedupInfo.existing_contact_id);
      resetForm();
      onClose();
    } else if (dedupChoice === "update") {
      setSaving(true);
      try {
        const data = {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          mobile_phone: mobilePhone.trim() || null,
      office_phone: officePhone.trim() || null,
          title: title.trim() || null,
          company_name: companyName.trim() || null,
          city: city.trim() || null,
          state: state.trim() || null,
          linkedin_url: linkedinUrl.trim() || null,
          industry_tags: tags.length > 0 ? tags : null,
          notes: notes.trim() || null,
        };
        await contactsApi.updateFull(dedupInfo.existing_contact_id, data);
        setSaved(true);
        setTimeout(() => {
          onSuccess?.(dedupInfo.existing_contact_id);
          resetForm();
          onClose();
        }, 500);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : "Update failed");
      } finally {
        setSaving(false);
      }
    } else if (dedupChoice === "duplicate") {
      await handleSave(true); // force create
    }
  }

  // === Cancel with confirmation ===
  function handleCancel() {
    if (isDirty) {
      setShowDiscard(true);
    } else {
      resetForm();
      onClose();
    }
  }

  function handleDiscard() {
    resetForm();
    onClose();
  }

  // === Field helper ===
  function FieldError({ msg }: { msg?: string }) {
    if (!msg) return null;
    return <p className="text-xs text-red-500 mt-1">{msg}</p>;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Contact</DialogTitle>
          </DialogHeader>

          {saved ? (
            <div className="py-8 text-center text-green-600 font-medium">
              ✓ Contact saved
            </div>
          ) : dedupInfo ? (
            /* === Dedup resolution view === */
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                <p className="text-sm font-medium text-amber-800">
                  ⚠️ Email already exists
                </p>
                <p className="text-sm text-amber-700 mt-1">
                  {email} is already in your contacts as:
                </p>
              </div>

              <div className="p-3 bg-gray-50 rounded-md">
                <p className="font-medium text-sm">{dedupInfo.existing_name}</p>
                <p className="text-xs text-gray-500">
                  {dedupInfo.existing_title}
                  {dedupInfo.existing_company && ` @ ${dedupInfo.existing_company}`}
                </p>
                {dedupInfo.last_activity_date && (
                  <p className="text-xs text-gray-400 mt-1">
                    Last contacted: {new Date(dedupInfo.last_activity_date).toLocaleDateString()}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">What would you like to do?</p>
                {(["view", "update", "duplicate"] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="dedup"
                      checked={dedupChoice === choice}
                      onChange={() => setDedupChoice(choice)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">
                      {choice === "view" && "View existing contact"}
                      {choice === "update" && "Update existing with new info"}
                      {choice === "duplicate" && "Create duplicate anyway"}
                    </span>
                  </label>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDedupInfo(null)}>Cancel</Button>
                <Button onClick={handleDedupContinue} disabled={saving}>
                  {saving ? "Saving..." : "Continue"}
                </Button>
              </div>
            </div>
          ) : (
            /* === Main form === */
            <div className="space-y-4 pt-2">
              {serverError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-600">{serverError}</p>
                </div>
              )}

              {/* Required fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>First Name <span className="text-red-500">*</span></Label>
                  <Input value={firstName} onChange={(e) => { setFirstName(e.target.value); markDirty(); }}
                    placeholder="John" maxLength={50} className={errors.first_name ? "border-red-400" : ""} />
                  <FieldError msg={errors.first_name} />
                </div>
                <div>
                  <Label>Last Name <span className="text-red-500">*</span></Label>
                  <Input value={lastName} onChange={(e) => { setLastName(e.target.value); markDirty(); }}
                    placeholder="Smith" maxLength={50} className={errors.last_name ? "border-red-400" : ""} />
                  <FieldError msg={errors.last_name} />
                </div>
              </div>

              <div>
                <Label>Email <span className="text-red-500">*</span></Label>
                <Input value={email} onChange={(e) => { setEmail(e.target.value); markDirty(); }}
                  placeholder="john@company.com" maxLength={255} type="email"
                  className={errors.email ? "border-red-400" : ""} />
                <FieldError msg={errors.email} />
              </div>

              {/* Optional fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>📱 Mobile</Label>
                  <Input value={mobilePhone} onChange={(e) => { setMobilePhone(e.target.value); markDirty(); }}
                    placeholder="+1-555-0100" maxLength={30}
                    className={errors.mobile_phone ? "border-red-400" : ""} />
                  <FieldError msg={errors.mobile_phone} />
                </div>
                <div>
                  <Label>☎️ Office</Label>
                  <Input value={officePhone} onChange={(e) => { setOfficePhone(e.target.value); markDirty(); }}
                    placeholder="+1-800-0000" maxLength={30}
                    className={errors.office_phone ? "border-red-400" : ""} />
                  <FieldError msg={errors.office_phone} />
                </div>
                <div>
                  <Label>Title</Label>
                  <Input value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }}
                    placeholder="VP of Sales" maxLength={100} />
                </div>
              </div>

              <div>
                <Label>Company Name</Label>
                <Input value={companyName} onChange={(e) => { setCompanyName(e.target.value); markDirty(); }}
                  placeholder="Acme Corp" maxLength={100} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>City</Label>
                  <Input value={city} onChange={(e) => { setCity(e.target.value); markDirty(); }}
                    placeholder="San Francisco" maxLength={100} />
                </div>
                <div>
                  <Label>State</Label>
                  <Input value={state} onChange={(e) => { setState(e.target.value); markDirty(); }}
                    placeholder="California" maxLength={50} />
                </div>
              </div>

              <div>
                <Label>LinkedIn URL</Label>
                <Input value={linkedinUrl} onChange={(e) => { setLinkedinUrl(e.target.value); markDirty(); }}
                  placeholder="https://linkedin.com/in/johnsmith" maxLength={500}
                  className={errors.linkedin_url ? "border-red-400" : ""} />
                <FieldError msg={errors.linkedin_url} />
              </div>

              <div>
                <Label>Website</Label>
                <Input value={website} onChange={(e) => { setWebsite(e.target.value); markDirty(); }}
                  placeholder="https://company.com" maxLength={500} />
              </div>

              {/* Industry Tags */}
              <div>
                <Label>Industry Tags</Label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs gap-1">
                      {tag}
                      <button onClick={() => removeTag(tag)} className="ml-1 hover:text-red-500">&times;</button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    placeholder="Type a tag and press Enter"
                    maxLength={30}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addTag}>+ Add</Button>
                </div>
                <FieldError msg={errors.industry_tags} />
              </div>

              {/* Notes */}
              <div>
                <div className="flex justify-between">
                  <Label>Notes</Label>
                  <span className={`text-xs ${notes.length > 2000 ? "text-red-500" : "text-gray-400"}`}>
                    {notes.length}/2000
                  </span>
                </div>
                <Textarea value={notes} onChange={(e) => { setNotes(e.target.value); markDirty(); }}
                  placeholder="Any notes about this contact..." rows={3} maxLength={2000}
                  className={errors.notes ? "border-red-400" : ""} />
                <FieldError msg={errors.notes} />
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                <Button onClick={() => handleSave(false)} disabled={!canSave || saving}>
                  {saving ? "Saving..." : "Save Contact"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Discard confirmation */}
      <Dialog open={showDiscard} onOpenChange={setShowDiscard}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-500">You have unsaved changes. Are you sure you want to discard them?</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowDiscard(false)}>Keep Editing</Button>
            <Button variant="destructive" onClick={handleDiscard}>Discard</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
