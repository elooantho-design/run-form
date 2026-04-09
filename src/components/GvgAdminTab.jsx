import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";


function getApiBase() {
  if (typeof window === "undefined") return "";

  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000";
  }

  return "";
}

export default function GvgAdminTab() {
  const apiBase = useMemo(() => getApiBase(), []);

  const [guild, setGuild] = useState("G1");
  const [jsonInput, setJsonInput] = useState("");
  const [loadingImport, setLoadingImport] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);
  const [message, setMessage] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  async function handleImport() {
    try {
      setLoadingImport(true);
      setMessage("");

      let parsed = null;

      try {
        parsed = JSON.parse(jsonInput);
      } catch {
        setMessage("JSON invalide.");
        return;
      }

      if (!Array.isArray(parsed) || !parsed.length) {
        setMessage("Le JSON doit être un tableau non vide.");
        return;
      }

      const response = await fetch(`${apiBase}/api/gvg-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guild,
          items: parsed,
        }),
      });

      const rawText = await response.text();
      let data = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setMessage(`Réponse non JSON import (${response.status})`);
        return;
      }

      if (!response.ok) {
        setMessage(`Erreur import : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setMessage(
        `Import OK : ${data?.inserted || 0} défenses injectées pour ${data?.guild}.`
      );
    } catch (error) {
      console.error("handleImport error:", error);
      setMessage(`Erreur import : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingImport(false);
    }
  }

  async function handleReset() {
    const confirmed = window.confirm(
      `Réinitialiser entièrement la GVG ${guild} ?`
    );

    if (!confirmed) return;

    try {
      setLoadingReset(true);
      setMessage("");

      const response = await fetch(`${apiBase}/api/gvg-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ guild }),
      });

      const rawText = await response.text();
      let data = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setMessage(`Réponse non JSON reset (${response.status})`);
        return;
      }

      if (!response.ok) {
        setMessage(`Erreur reset : ${data?.error || "erreur inconnue"}`);
        return;
      }

      setMessage(`Reset OK : ${data?.guild} vidé.`);
    } catch (error) {
      console.error("handleReset error:", error);
      setMessage(`Erreur reset : ${error?.message || "erreur inconnue"}`);
    } finally {
      setLoadingReset(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
        <CardHeader className="border-b border-zinc-800">
          <CardTitle className="text-lg text-zinc-100">
            Admin GVG
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6 p-4 md:p-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-sm text-zinc-400">Guilde ciblée</div>

            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                type="button"
                variant={guild === "G1" ? "default" : "outline"}
                className="rounded-2xl"
                onClick={() => setGuild("G1")}
              >
                G1
              </Button>

              <Button
                type="button"
                variant={guild === "G2" ? "default" : "outline"}
                className="rounded-2xl"
                onClick={() => setGuild("G2")}
              >
                G2
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
            <div className="text-sm text-zinc-400">
              Colle ici le contenu du fichier detected min JSON
            </div>

            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='[ { "def": "...", "compo": [...] } ]'
              className="mt-3 min-h-[280px] w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="rounded-2xl"
              disabled={loadingImport || loadingReset}
              onClick={handleImport}
            >
              {loadingImport ? "Import en cours..." : `Importer ${guild}`}
            </Button>

            <Button
              type="button"
              variant="destructive"
              className="rounded-2xl"
              disabled={loadingImport || loadingReset}
              onClick={handleReset}
            >
              {loadingReset ? "Reset..." : `Reset ${guild}`}
            </Button>
          </div>

          {message ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
              {message}
            </div>
          ) : null}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
  <div className="text-sm text-zinc-300">
    Upload des images GVG (multi-sélection)
  </div>

  <input
    type="file"
    multiple
    accept="image/*"
onChange={async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  const BATCH_SIZE = 8;

  try {
    setUploadingImages(true);
    setUploadResult(null);

    const allResults = [];
    let currentGuild = guild;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const formData = new FormData();
      formData.append("guild", currentGuild);

      batch.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch(`${apiBase}/api/gvg-upload-images`, {
        method: "POST",
        body: formData,
      });

      const rawText = await response.text();
      let data = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setUploadResult({
          error: `Réponse non JSON upload (${response.status})`,
          rawText,
          batchStart: i,
          batchEnd: i + batch.length - 1,
        });
        return;
      }

      if (!response.ok) {
        setUploadResult({
          error: data?.error || `Erreur upload batch (${response.status})`,
          details: data,
          batchStart: i,
          batchEnd: i + batch.length - 1,
        });
        return;
      }

      if (Array.isArray(data?.results)) {
        allResults.push(...data.results);
      }
    }

    setUploadResult({
      success: true,
      guild: currentGuild,
      totalFiles: files.length,
      results: allResults,
    });
  } catch (err) {
    console.error(err);
    setUploadResult({ error: err.message });
  } finally {
    setUploadingImages(false);
  }
}}
className="text-sm text-zinc-200"
/>

{uploadingImages ? (
  <div className="text-sm text-zinc-400">Upload en cours...</div>
) : null}

{uploadResult ? (
  <div className="text-xs text-zinc-300 whitespace-pre-wrap">
    {JSON.stringify(uploadResult, null, 2)}
  </div>
) : null}
</div>
        </CardContent>
      </Card>
    </div>
  );
}