import React, { useState, useRef } from "react";
import { supabase } from "./supabaseClient";

function normalizeImageUrls(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      /* single URL string */
    }
    return [t];
  }
  return [];
}

export default function MemoryArchitecture() {
  const STORAGE_BUCKET = "home-photos";
  const MAX_IMAGES = 8;
  const UPDATES_TABLE = "client_request_updates";

  const [form, setForm] = useState({
    name: "",
    email: "",
    style: "standard",
    interior: false,
    notes: "",
  });
  const [fileItems, setFileItems] = useState([]);
  const fileInputRef = useRef(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState(null);
  const [zoomedImage, setZoomedImage] = useState(null);
  const [trackForm, setTrackForm] = useState({ name: "", email: "" });
  const [trackLoading, setTrackLoading] = useState(false);
  const [trackError, setTrackError] = useState(null);
  const [trackRequest, setTrackRequest] = useState(null);
  const [trackUpdates, setTrackUpdates] = useState([]);

  const makeObjectKey = (file) => {
    const ext = file?.name?.includes(".") ? file.name.split(".").pop() : "bin";
    const id =
      (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `client_requests/${new Date().toISOString().slice(0, 10)}/${id}.${ext}`;
  };

  const uploadSelectedFiles = async () => {
    if (!fileItems.length) return [];

    const selected = fileItems.map((item) => item.file);
    const uploadedUrls = [];

    for (const file of selected) {
      const objectKey = makeObjectKey(file);
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(objectKey, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectKey);
      uploadedUrls.push(publicData.publicUrl);
    }

    return uploadedUrls;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === "checkbox") {
      setForm((prev) => ({ ...prev, [name]: checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleAddFiles = (e) => {
    const incoming = Array.from(e.target.files || []);
    e.target.value = "";
    if (!incoming.length) return;

    setFileItems((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setSubmitMessage({ type: "error", text: `You can upload up to ${MAX_IMAGES} images.` });
        return prev;
      }
      const toAdd = incoming.slice(0, room);
      if (incoming.length > room) {
        setSubmitMessage({ type: "error", text: `Only ${room} more image(s) allowed (max ${MAX_IMAGES}).` });
      }
      const next = [
        ...prev,
        ...toAdd.map((file) => ({
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
      ];
      return next;
    });
  };

  const removeFileItem = (id) => {
    setFileItems((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const clearAllFiles = () => {
    setFileItems((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitMessage(null);

    if (!form.name.trim() || !form.email.trim()) {
      setSubmitMessage({ type: "error", text: "Please provide your name and email." });
      setIsSubmitting(false);
      return;
    }
    if (!form.email.includes("@")) {
      setSubmitMessage({ type: "error", text: "Enter a valid email address." });
      setIsSubmitting(false);
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 600));

    try {
      const { data: existing, error: existingError } = await supabase
        .from("client_requests")
        .select("id,image_urls")
        .eq("name", form.name)
        .eq("email", form.email)
        .limit(1)
        .maybeSingle();

      if (existingError) {
        console.error(existingError);
        throw existingError;
      }

      let imageUrls = [];
      if (fileItems.length > 0) {
        imageUrls = await uploadSelectedFiles();
      } else if (normalizeImageUrls(existing?.image_urls).length) {
        imageUrls = normalizeImageUrls(existing?.image_urls);
      }

      const payload = {
        name: form.name,
        email: form.email,
        style: form.style,
        interior: form.interior,
        notes: form.notes.trim() ? form.notes : null,
        image_urls: imageUrls,
      };

      if (existing?.id) {
        const shouldOverwrite = window.confirm(
          "We already have a request with this name and email. Do you want to overwrite it?"
        );
        if (!shouldOverwrite) {
          setSubmitMessage({
            type: "error",
            text: "Submission cancelled. Your request has already been submitted.",
          });
          setIsSubmitting(false);
          setTimeout(() => setSubmitMessage(null), 60000);
          return;
        }

        const { error: updateError } = await supabase
          .from("client_requests")
          .update(payload, { returning: "minimal" })
          .eq("id", existing.id);

        if (updateError) {
          console.error(updateError);
          throw updateError;
        }
      } else {
        const { error: insertError } = await supabase
          .from("client_requests")
          .insert([payload], { returning: "minimal" });

        if (insertError) {
          console.error(insertError);
          throw insertError;
        }
      }

      setForm({ name: "", email: "", style: "standard", interior: false, notes: "" });
      clearAllFiles();

      setSubmitMessage({
        type: "success",
        text: "Your request has been captured. We'll be in touch within 24h.",
      });
    } catch (err) {
      console.error(err);
      const message =
        (err && (err.message || err.details || err.hint)) ||
        (typeof err === "string" ? err : "") ||
        "Submission failed. Please try again.";
      setSubmitMessage({ type: "error", text: `Submission failed: ${message}` });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setSubmitMessage(null), 60000);
    }
  };

  const handleTrackChange = (e) => {
    const { name, value } = e.target;
    setTrackForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleTrack = async (e) => {
    e.preventDefault();
    setTrackLoading(true);
    setTrackError(null);
    setTrackRequest(null);
    setTrackUpdates([]);

    const name = trackForm.name.trim();
    const email = trackForm.email.trim();
    if (!name || !email) {
      setTrackError("Please provide your name and email.");
      setTrackLoading(false);
      return;
    }

    try {
      const { data: req, error: reqError } = await supabase
        .from("client_requests")
        .select("id,created_at,name,email,style,interior,notes,image_urls")
        .eq("name", name)
        .eq("email", email)
        .limit(1)
        .maybeSingle();

      if (reqError) throw reqError;
      if (!req) {
        setTrackError("No order found for this name and email.");
        setTrackLoading(false);
        return;
      }

      setTrackRequest(req);

      const { data: updates, error: updatesError } = await supabase
        .from(UPDATES_TABLE)
        .select("id,created_at,status_text,image_urls")
        .eq("request_id", req.id)
        .order("created_at", { ascending: false });

      if (updatesError) throw updatesError;
      setTrackUpdates(updates || []);
    } catch (err) {
      console.error(err);
      const message =
        (err && (err.message || err.details || err.hint)) ||
        (typeof err === "string" ? err : "") ||
        "Failed to load order status.";
      setTrackError(message);
    } finally {
      setTrackLoading(false);
    }
  };

  const styles = {
    container: {
      minHeight: "100vh",
      backgroundColor: "#F9F5F0",
      color: "#3A3532",
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    },
    wrapper: {
      maxWidth: "1024px",
      margin: "0 auto",
      padding: "48px 20px",
    },
    header: { textAlign: "center", marginBottom: "20px" },
    title: {
      fontSize: "2.5rem",
      fontWeight: 300,
      letterSpacing: "-0.01em",
      color: "#3A3532",
      margin: 0,
    },
    titleAccent: {
      fontStyle: "italic",
      fontWeight: 400,
      color: "#C98A7A",
    },
    subtitle: {
      fontSize: "1.25rem",
      fontWeight: 300,
      color: "#6B625A",
      maxWidth: "640px",
      margin: "16px auto 0",
      lineHeight: 1.5,
    },
    heroVideoSection: { width: "100%", marginBottom: "32px" },
    heroVideoWrap: {
      position: "relative",
      width: "100%",
      aspectRatio: "16 / 9",
      borderRadius: "16px",
      overflow: "hidden",
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      border: "1px solid #E5D9D0",
      backgroundColor: "#1a1a1a",
    },
    heroVideoIframe: { position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" },
    grid: { display: "grid", gridTemplateColumns: "3.6fr 2.8fr", gap: "32px" },
    formCard: {
      gridColumn: "1",
      backgroundColor: "#FFFCF9",
      borderRadius: "16px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
      border: "1px solid #E5D9D0",
      padding: "28px",
    },
    formTitle: {
      fontSize: "1.25rem",
      fontWeight: 300,
      letterSpacing: "-0.01em",
      color: "#3A3532",
      borderLeft: "2px solid #C98A7A",
      paddingLeft: "16px",
      marginBottom: "24px",
    },
    label: {
      display: "block",
      fontSize: "0.875rem",
      fontWeight: 500,
      color: "#6B625A",
      marginBottom: "4px",
    },
    input: {
      width: "100%",
      padding: "10px 16px",
      backgroundColor: "#FDFBF9",
      border: "1px solid #E5D9D0",
      borderRadius: "12px",
      fontSize: "1rem",
      outline: "none",
      transition: "all 0.2s",
      boxSizing: "border-box",
    },
    textarea: {
      width: "100%",
      padding: "10px 16px",
      backgroundColor: "#FDFBF9",
      border: "1px solid #E5D9D0",
      borderRadius: "12px",
      fontSize: "1rem",
      outline: "none",
      resize: "vertical",
      fontFamily: "inherit",
      boxSizing: "border-box",
    },
    checkboxWrapper: { display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" },
    fileArea: {
      marginTop: "4px",
      display: "flex",
      justifyContent: "center",
      padding: "20px",
      border: "1px dashed #D3C7BB",
      borderRadius: "12px",
      backgroundColor: "#FDFBF9",
      textAlign: "center",
    },
    fileLabel: { cursor: "pointer", color: "#C98A7A", fontSize: "0.875rem" },
    fileThumbRow: {
      display: "flex",
      flexWrap: "wrap",
      gap: "10px",
      alignItems: "center",
      justifyContent: "flex-start",
      marginTop: "8px",
    },
    fileThumbWrap: { position: "relative", width: "72px", height: "72px", flexShrink: 0 },
    fileThumb: {
      width: "72px",
      height: "72px",
      objectFit: "cover",
      borderRadius: "10px",
      border: "1px solid #E5D9D0",
      display: "block",
    },
    fileThumbRemove: {
      position: "absolute",
      top: "-6px",
      right: "-6px",
      width: "22px",
      height: "22px",
      borderRadius: "9999px",
      border: "1px solid #E5D9D0",
      backgroundColor: "#FFFCF9",
      color: "#C98A7A",
      fontSize: "14px",
      lineHeight: "20px",
      cursor: "pointer",
      padding: 0,
    },
    addMoreTile: {
      width: "72px",
      height: "72px",
      borderRadius: "10px",
      border: "1px dashed #D3C7BB",
      backgroundColor: "#FDFBF9",
      color: "#C98A7A",
      fontSize: "1.75rem",
      fontWeight: 300,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      flexShrink: 0,
      userSelect: "none",
    },
    button: {
      width: "100%",
      padding: "12px",
      borderRadius: "9999px",
      border: "none",
      backgroundColor: "#3A3532",
      color: "white",
      fontSize: "1rem",
      fontWeight: 300,
      letterSpacing: "0.3px",
      cursor: "pointer",
      transition: "background 0.2s",
      marginTop: "8px",
    },
    buttonDisabled: { backgroundColor: "#B9AFA5", cursor: "not-allowed" },
    rightColumn: { gridColumn: "2", display: "flex", flexDirection: "column", gap: "24px" },
    infoCard: {
      backgroundColor: "#FFFCF9",
      borderRadius: "16px",
      border: "1px solid #E5D9D0",
      padding: "24px",
      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
    },
    infoTitle: { fontSize: "1.125rem", fontWeight: 300, color: "#3A3532", margin: "0 0 16px 0", letterSpacing: "-0.01em" },
    listItem: { display: "flex", gap: "8px", fontSize: "0.875rem", color: "#6B625A", marginBottom: "8px" },
    divider: { marginTop: "24px", paddingTop: "16px", borderTop: "1px solid #E5D9D0" },
    priceRow: { display: "flex", justifyContent: "space-between", fontSize: "0.875rem", marginBottom: "8px" },
    priceValue: { color: "#C98A7A" },
    footnote: { fontSize: "0.75rem", color: "#9B8C7E", marginTop: "12px" },
    pledgeCard: {
      backgroundColor: "#F2EFEA",
      borderRadius: "16px",
      border: "1px solid #E5D9D0",
      padding: "24px",
    },
    stats: {
      display: "flex",
      justifyContent: "space-around",
      textAlign: "center",
      marginTop: "16px",
      fontSize: "0.75rem",
      color: "#9B8C7E",
    },
    statNumber: { display: "block", fontSize: "1.5rem", fontFamily: "Georgia, serif", color: "#3A3532" },
    caseCard: {
      backgroundColor: "#FFFCF9",
      borderRadius: "16px",
      border: "1px solid #E5D9D0",
      padding: "24px",
      boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
    },
    caseTitle: {
      fontSize: "1rem",
      fontWeight: 400,
      letterSpacing: "-0.01em",
      color: "#3A3532",
      margin: "0 0 20px 0",
      borderBottom: "1px solid #E5D9D0",
      paddingBottom: "12px",
    },
    caseGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "16px",
    },
    caseItem: {},
    caseImage: {
      width: "100%",
      aspectRatio: "4/3",
      objectFit: "cover",
      borderRadius: "12px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.05)",
      border: "1px solid #F0EBE4",
    },
    caseCaption: {
      fontSize: "0.75rem",
      color: "#6B625A",
      marginTop: "8px",
      textAlign: "center",
      fontStyle: "italic",
    },
    historySection: {
      marginTop: "80px",
      backgroundColor: "#FFFCF9",
      borderRadius: "16px",
      border: "1px solid #E5D9D0",
      padding: "24px",
    },
    historyHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      borderBottom: "1px solid #E5D9D0",
      paddingBottom: "12px",
      marginBottom: "20px",
    },
    historyTitle: { fontSize: "1rem", fontWeight: 300, color: "#3A3532", margin: 0 },
    historyBadge: { fontSize: "0.75rem", color: "#9B8C7E" },
    historyGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: "16px",
    },
    historyItem: {
      backgroundColor: "#FDFBF9",
      borderRadius: "12px",
      padding: "12px",
      border: "1px solid #E5D9D0",
    },
    deleteButton: { background: "none", border: "none", color: "#C98A7A", cursor: "pointer", fontSize: "12px" },
    footer: {
      marginTop: "64px",
      paddingTop: "24px",
      textAlign: "center",
      fontSize: "0.75rem",
      color: "#CBC0B4",
      borderTop: "1px solid #E5D9D0",
    },
    row2cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" },
    fullWidth: { marginBottom: "20px" },
    errorMsg: { padding: "12px", borderRadius: "12px", textAlign: "center", fontSize: "0.875rem", marginBottom: "16px" },
    modalOverlay: {
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.65)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      zIndex: 9999,
    },
    modalImage: {
      maxWidth: "min(960px, 92vw)",
      maxHeight: "86vh",
      width: "auto",
      height: "auto",
      borderRadius: "12px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
      backgroundColor: "#111",
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.wrapper}>
        <div style={styles.header}>
          <h1 style={styles.title}>
            A home you can hold. A <span style={styles.titleAccent}>memory</span> you won't lose.
          </h1>
          <p style={styles.subtitle}>
            Your home, hand-crafted to hold its memories.
          </p>
        </div>

        <div style={styles.heroVideoSection}>
          <div style={styles.heroVideoWrap}>
            <iframe
              src="https://www.youtube.com/embed/nk54iRRgvQk?autoplay=1&mute=1&playsinline=1"
              title="Memory Architecture — showcase video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              style={styles.heroVideoIframe}
            />
          </div>
        </div>

        <div style={styles.grid}>
          {/* 左侧表单 */}
          <div style={styles.formCard}>
            <h2 style={styles.formTitle}>Create your custom home miniature</h2>
            <form onSubmit={handleSubmit}>
              <div style={styles.row2cols}>
                <div>
                  <label style={styles.label}>Full name</label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="e.g., Eleanor Whitman"
                    style={styles.input}
                    onFocus={(e) => (e.target.style.borderColor = "#C98A7A")}
                    onBlur={(e) => (e.target.style.borderColor = "#E5D9D0")}
                  />
                </div>
                <div>
                  <label style={styles.label}>Email address</label>
                  <input
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="hello@memory.com"
                    style={styles.input}
                    onFocus={(e) => (e.target.style.borderColor = "#C98A7A")}
                    onBlur={(e) => (e.target.style.borderColor = "#E5D9D0")}
                  />
                </div>
              </div>

              <div style={styles.row2cols}>
                <div>
                  <label style={styles.label}>Edition</label>
                  <select
                    name="style"
                    value={form.style}
                    onChange={handleChange}
                    style={{ ...styles.input, cursor: "pointer" }}
                  >
                    <option value="standard">Standard — $699+</option>
                    <option value="premium">Premium — $999+</option>
                    <option value="collector">Collector — $1499+</option>
                  </select>
                </div>
                <div style={styles.checkboxWrapper}>
                  <input
                    type="checkbox"
                    name="interior"
                    id="interior"
                    checked={form.interior}
                    onChange={handleChange}
                    style={{ width: "16px", height: "16px", accentColor: "#C98A7A" }}
                  />
                  <label htmlFor="interior" style={styles.label}>
                    + Interior detailing (add $200)
                  </label>
                </div>
              </div>

              <div style={styles.fullWidth}>
                <label style={styles.label}>Photographs of the home</label>
                <div style={styles.fileArea}>
                  <div style={{ width: "100%" }}>
                    <input
                      ref={fileInputRef}
                      id="file-upload-add"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      style={{ display: "none" }}
                      onChange={handleAddFiles}
                    />
                    {fileItems.length === 0 ? (
                      <label htmlFor="file-upload-add" style={styles.fileLabel}>
                        Upload images (JPEG, PNG) — up to {MAX_IMAGES}
                      </label>
                    ) : (
                      <div style={styles.fileThumbRow}>
                        {fileItems.map((item) => (
                          <div key={item.id} style={styles.fileThumbWrap}>
                            <img src={item.previewUrl} alt="" style={styles.fileThumb} />
                            <button
                              type="button"
                              aria-label="Remove image"
                              style={styles.fileThumbRemove}
                              onClick={() => removeFileItem(item.id)}
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        {fileItems.length < MAX_IMAGES && (
                          <label htmlFor="file-upload-add" style={styles.addMoreTile} title="Add another photo">
                            +
                          </label>
                        )}
                      </div>
                    )}
                    {fileItems.length > 0 && (
                      <div style={{ fontSize: "12px", color: "#6B625A", marginTop: "8px", textAlign: "center" }}>
                        {fileItems.length} / {MAX_IMAGES} photos
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div style={styles.fullWidth}>
                <label style={styles.label}>Special memories or details</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows="3"
                  placeholder="Tell us a story — the smell of cookies in the kitchen, morning light through the bay window, the old oak tree..."
                  style={styles.textarea}
                  onFocus={(e) => (e.target.style.borderColor = "#C98A7A")}
                  onBlur={(e) => (e.target.style.borderColor = "#E5D9D0")}
                />
              </div>

              {submitMessage && (
                <div
                  style={{
                    ...styles.errorMsg,
                    backgroundColor: submitMessage.type === "success" ? "#E9E5DE" : "#F5EAE6",
                    color: submitMessage.type === "success" ? "#8FA08B" : "#C98A7A",
                  }}
                >
                  {submitMessage.text}
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  ...styles.button,
                  ...(isSubmitting ? styles.buttonDisabled : {}),
                }}
                onMouseEnter={(e) => {
                  if (!isSubmitting) e.target.style.backgroundColor = "#5C534B";
                }}
                onMouseLeave={(e) => {
                  if (!isSubmitting) e.target.style.backgroundColor = "#3A3532";
                }}
              >
                {isSubmitting ? "Preserving your memory ..." : "Begin your model →"}
              </button>
              <p style={{ fontSize: "12px", textAlign: "center", color: "#9B8C7E", marginTop: "12px" }}>
                Our artisans will reach out within 24 hours.
              </p>
            </form>
          </div>

          {/* 右侧列 - 案例展示移至顶部 */}
          <div style={styles.rightColumn}>
            {/* 1. 过往案例展示 */}
            <div style={styles.caseCard}>
              <h3 style={styles.caseTitle}>A recent case:</h3>
              <div style={styles.caseGrid}>
                <div style={styles.caseItem}>
                  <img
                    src="https://i.imgur.com/7rMF0U1.jpg"
                    alt="An old house in Shanghai"
                    style={{ ...styles.caseImage, cursor: "zoom-in" }}
                    onClick={() =>
                      setZoomedImage({
                        src: "https://i.imgur.com/7rMF0U1.jpg",
                        alt: "An old house in Shanghai",
                      })
                    }
                  />
                  <div style={styles.caseCaption}>An old house in Shanghai</div>
                </div>
                <div style={styles.caseItem}>
                  <img
                    src="https://i.imgur.com/UyoaLSI.jpeg"
                    alt="Interior structures"
                    style={{ ...styles.caseImage, cursor: "zoom-in" }}
                    onClick={() =>
                      setZoomedImage({
                        src: "https://i.imgur.com/UyoaLSI.jpeg",
                        alt: "Interior structures",
                      })
                    }
                  />
                  <div style={styles.caseCaption}>Interior structures</div>
                </div>
              </div>
              <p style={{ fontSize: "0.7rem", color: "#9B8C7E", marginTop: "16px", textAlign: "center" }}>
                Real client works · Handcrafted with precision
              </p>
            </div>

            {/* 2. Why this matters */}
            <div style={styles.infoCard}>
              <h3 style={styles.infoTitle}>Why this matters</h3>
              <ul style={{ listStyle: "none", paddingLeft: 0, margin: "16px 0 0" }}>
                <li style={styles.listItem}>— A memory that grows with your family</li>
                <li style={styles.listItem}>— Built with precision, finished by hand</li>
                <li style={styles.listItem}>— Every detail tells a story</li>
                <li style={styles.listItem}>— Holding the warmth of everyday moments</li>
              </ul>
              <div style={styles.divider}>
                <div style={styles.priceRow}>
                  <span>Standard</span>
                  <span style={styles.priceValue}>$699+</span>
                </div>
                <div style={styles.priceRow}>
                  <span>Premium (int. structure)</span>
                  <span style={styles.priceValue}>$999+</span>
                </div>
                <div style={styles.priceRow}>
                  <span>Collector (full detail)</span>
                  <span style={styles.priceValue}>$1499+</span>
                </div>
                <p style={styles.footnote}>*estimated, based on architecture complexity</p>
              </div>
            </div>

            {/* 3. ARTISAN'S PLEDGE */}
            <div style={styles.pledgeCard}>
              <p style={{ fontSize: "0.875rem", fontWeight: 300, letterSpacing: "0.3px", margin: "0 0 8px" }}>
                ORDER TRACKING
              </p>
              <p style={{ fontSize: "0.875rem", color: "#6B625A", lineHeight: 1.5, margin: "0 0 12px" }}>
                Enter the same name and email you used to submit your request.
              </p>

              <form onSubmit={handleTrack}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
                  <input
                    type="text"
                    name="name"
                    value={trackForm.name}
                    onChange={handleTrackChange}
                    placeholder="Full name"
                    style={styles.input}
                    onFocus={(e) => (e.target.style.borderColor = "#C98A7A")}
                    onBlur={(e) => (e.target.style.borderColor = "#E5D9D0")}
                  />
                  <input
                    type="email"
                    name="email"
                    value={trackForm.email}
                    onChange={handleTrackChange}
                    placeholder="Email address"
                    style={styles.input}
                    onFocus={(e) => (e.target.style.borderColor = "#C98A7A")}
                    onBlur={(e) => (e.target.style.borderColor = "#E5D9D0")}
                  />
                  <button
                    type="submit"
                    disabled={trackLoading}
                    style={{
                      ...styles.button,
                      ...(trackLoading ? styles.buttonDisabled : {}),
                      marginTop: 0,
                    }}
                  >
                    {trackLoading ? "Checking..." : "Track my order →"}
                  </button>
                </div>
              </form>

              {trackError && (
                <div style={{ ...styles.errorMsg, backgroundColor: "#F5EAE6", color: "#C98A7A", marginTop: "12px" }}>
                  {trackError}
                </div>
              )}

              {trackRequest && (
                <div style={{ marginTop: "14px" }}>
                  <div style={{ fontSize: "0.75rem", color: "#9B8C7E", marginBottom: "10px" }}>
                    Submitted: {new Date(trackRequest.created_at).toLocaleString()}
                  </div>

                  {trackUpdates.length === 0 ? (
                    <div style={{ fontSize: "0.875rem", color: "#6B625A", lineHeight: 1.5 }}>
                      No progress updates yet. Please check back later.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {trackUpdates.map((u) => {
                        const progressImages = normalizeImageUrls(u.image_urls);
                        return (
                          <div
                            key={u.id}
                            style={{
                              backgroundColor: "#FFFCF9",
                              border: "1px solid #E5D9D0",
                              borderRadius: "12px",
                              padding: "12px",
                            }}
                          >
                            <div style={{ fontSize: "0.75rem", color: "#9B8C7E", marginBottom: "6px" }}>
                              {new Date(u.created_at).toLocaleString()}
                            </div>
                            <div style={{ fontSize: "0.875rem", color: "#3A3532", lineHeight: 1.5 }}>
                              {u.status_text}
                            </div>
                            {progressImages.length > 0 && (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "10px", marginTop: "10px" }}>
                                {progressImages.map((url, idx) => (
                                  <img
                                    key={`${u.id}-${idx}-${url}`}
                                    src={url}
                                    alt="Progress"
                                    style={{ ...styles.caseImage, cursor: "zoom-in" }}
                                    onClick={() => setZoomedImage({ src: url, alt: "Progress update" })}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {zoomedImage && (
          <div
            style={styles.modalOverlay}
            onClick={() => setZoomedImage(null)}
            role="dialog"
            aria-modal="true"
          >
            <img
              src={zoomedImage.src}
              alt={zoomedImage.alt}
              style={styles.modalImage}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        <footer style={styles.footer}>
          © 2026 Memory Architecture Studio — every house holds a universe.
        </footer>
      </div>
    </div>
  );
}