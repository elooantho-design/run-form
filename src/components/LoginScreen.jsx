import React, { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginScreen({ onLogin }) {
  const [discordId, setDiscordId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const cleanDiscordId = discordId.trim();
    const cleanPassword = password.trim();

    const { data, error: dbError } = await supabase
      .from("guild_members")
      .select("id, role, discord_id, watcher_name, password")
      .eq("discord_id", cleanDiscordId)
      .eq("password", cleanPassword)
      .maybeSingle();

    setLoading(false);

    if (dbError) {
      setError("Erreur lors de la connexion.");
      return;
    }

    if (!data) {
      setError("Identifiant Discord ou mot de passe incorrect.");
      return;
    }

    onLogin({
      memberId: data.id,
      role: data.role,
      discordId: data.discord_id,
      name: data.watcher_name,
      password: data.password,
    });
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-zinc-50">
            Connexion au dashboard
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Entre ton ID Discord et ton mot de passe.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-zinc-300">ID Discord</label>
            <Input
              value={discordId}
              onChange={(e) => setDiscordId(e.target.value)}
              placeholder="Ex : 259417928569585665"
              className="rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100"
              autoComplete="username"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-zinc-300">Mot de passe</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              className="rounded-2xl border-zinc-700 bg-zinc-950 text-zinc-100"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </Button>
        </form>
      </div>
    </div>
  );
}