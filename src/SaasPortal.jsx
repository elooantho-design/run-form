import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Cpu,
  FileJson,
  Gauge,
  Grid3X3,
  HardDrive,
  LayoutDashboard,
  Lock,
  LogOut,
  Play,
  Search,
  SearchCheck,
  Server,
  Settings,
  Shield,
  Sparkles,
  Star,
  UploadCloud,
  Users,
  WalletCards,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import DemonMonstersTab from "@/components/DemonMonstersTab";
import SoulStonesTab from "@/components/SoulStonesTab";
import PersonalBestTab from "@/components/PersonalBestTab";
import MyDefensesTab from "@/components/MyDefensesTab";
import GvgCurrentTab from "@/components/GvgCurrentTab";
import GvgPanelTab from "@/components/GvgPanelTab";
import GvgAdminTab from "@/components/GvgAdminTab";
import GvgValidationTab from "@/components/GvgValidationTab";

const navigation = [
  { id: "home", label: "Accueil", icon: LayoutDashboard },
  { id: "hero-box", label: "Ma box heros", icon: Grid3X3 },
  { id: "soul-stones", label: "Pierre d'ame", icon: Sparkles },
  { id: "demon-monsters", label: "Monstres demoniaques", icon: Shield },
  { id: "personal-best", label: "Mes PB", icon: Activity },
  { id: "defenses", label: "Mes defenses", icon: Bot },
  { id: "gvg", label: "GVG", icon: Shield },
  { id: "launcher", label: "Launcher", icon: Bot },
  { id: "validation", label: "Validation", icon: SearchCheck },
  { id: "templates", label: "Templates", icon: Grid3X3 },
  { id: "guilds", label: "Guildes", icon: Users },
  { id: "billing", label: "Licences", icon: WalletCards },
  { id: "logs", label: "Logs", icon: Activity },
  { id: "settings", label: "Parametres", icon: Settings },
];

const categoryCards = [
  {
    id: "profile",
    title: "Mon profil",
    description: "Gerez vos informations personnelles et vos preferences.",
    icon: Users,
    tone: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  },
  {
    id: "hero-box",
    title: "Ma box heros",
    description: "Accedez a votre collection et gerez vos heros.",
    icon: Grid3X3,
    tone: "border-indigo-500/25 bg-indigo-500/10 text-indigo-200",
    target: "hero-box",
  },
  {
    id: "soul-stones",
    title: "Pierres d'ame",
    description: "Gerez et optimisez vos pierres d'ame.",
    icon: Sparkles,
    tone: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    target: "soul-stones",
  },
  {
    id: "demon-monsters",
    title: "Monstres demoniaques",
    description: "Affrontez les forces obscures et domptez-les.",
    icon: Shield,
    tone: "border-red-500/25 bg-red-500/10 text-red-200",
    target: "demon-monsters",
  },
  {
    id: "personal-best",
    title: "Mes PB",
    description: "Consultez vos records et performances personnelles.",
    icon: Activity,
    tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    target: "personal-best",
  },
  {
    id: "defenses",
    title: "Mes defenses",
    description: "Configurez et renforcez vos defenses.",
    icon: Bot,
    tone: "border-violet-500/25 bg-violet-500/10 text-violet-200",
    target: "defenses",
  },
];

const guildRows = [
  { name: "Cluster Paladin", plan: "Interne", gvg: "G1 - G7", status: "Actif", tone: "emerald" },
  { name: "Guilde externe test", plan: "Essai", gvg: "G2", status: "A valider", tone: "amber" },
  { name: "Prospect", plan: "Aucun", gvg: "-", status: "Invite", tone: "zinc" },
];

const runSteps = [
  { label: "Launcher en ligne", status: "pret", icon: Cpu },
  { label: "Calibration plein ecran", status: "attente", icon: Gauge },
  { label: "Capture 48 defenses", status: "attente", icon: UploadCloud },
  { label: "Reco serveur", status: "attente", icon: FileJson },
  { label: "Validation joueur", status: "attente", icon: CheckCircle2 },
];

const bastions = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  title: `Bastion ${index + 1}`,
  done: index === 0 ? 12 : index === 1 ? 8 : 0,
  total: 12,
  status: index === 0 ? "pret" : index === 1 ? "controle" : "vide",
}));

const calquesBaseUrl = String(import.meta.env?.VITE_CALQUES_BASE_URL || "").replace(/\/$/, "");

function isLocalHost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function calqueUrl(kind, fileName) {
  const folders = {
    hero: "hero-calques",
    faction: "faction-calques",
    role: "role-calques",
  };
  const folder = folders[kind];
  const encodedFile = encodeURIComponent(fileName);

  if (calquesBaseUrl) return `${calquesBaseUrl}/${folder}/${encodedFile}`;
  if (isLocalHost()) return `/${folder}/${encodedFile}`;

  return `/api/gvg-server?action=calque&kind=${kind}&file=${encodedFile}`;
}

const heroRarityOrder = ["legendary", "epic", "rare", "ordinary", "basic"];

const heroRarityFilters = [
  { id: "all", label: "Toutes", color: "#facc15" },
  { id: "legendary", label: "Legendaires", color: "#facc15" },
  { id: "epic", label: "Epiques", color: "#c084fc" },
  { id: "rare", label: "Rares", color: "#38bdf8" },
  { id: "ordinary", label: "Ordinaires", color: "#4ade80" },
  { id: "basic", label: "Basiques", color: "#a1a1aa" },
];

const heroRoleFilters = [
  { id: "all", label: "Tous les roles" },
  { id: "combattant", label: "Combattant", image: calqueUrl("role", "Combattant.png") },
  { id: "heal", label: "Heal", image: calqueUrl("role", "Heal.png") },
  { id: "mage", label: "Mage", image: calqueUrl("role", "Mage.png") },
  { id: "tacticien", label: "Tacticien", image: calqueUrl("role", "Tacticien.png") },
  { id: "tank", label: "Tank", image: calqueUrl("role", "Tank.png") },
  { id: "tireur", label: "Tireur", image: calqueUrl("role", "Tireur.png") },
];

const heroFactionFilters = [
  { id: "all", label: "Toutes les factions" },
  { id: "arbitre", label: "Arbitre", image: calqueUrl("faction", "Arbitre.png") },
  { id: "cauchemar", label: "Cauchemar", image: calqueUrl("faction", "Cauchemar.png") },
  { id: "chaotique", label: "Chaotique", image: calqueUrl("faction", "Chaotique.png") },
  { id: "cultiste", label: "Cultiste", image: calqueUrl("faction", "Cultiste.png") },
  { id: "esoterique", label: "Esoterique", image: calqueUrl("faction", "Esoterique.png") },
  { id: "infernal", label: "Infernal", image: calqueUrl("faction", "Infernal.png") },
  { id: "innommable", label: "Innommable", image: calqueUrl("faction", "Innommable.png") },
  { id: "nordiste", label: "Nordiste", image: calqueUrl("faction", "Nordiste.png") },
  { id: "perceur", label: "Perceur", image: calqueUrl("faction", "Perceur.png") },
  { id: "sentinelle", label: "Sentinelle", image: calqueUrl("faction", "Sentinelle.png") },
];

const heroLayerData = [
    { fileName: "Abomination.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Aedrin.png", rarity: "legendary", factions: ["nordiste"] },
    { fileName: "Aeris.png", rarity: "legendary", factions: ["sentinelle", "esoterique"] },
    { fileName: "Amiral.png", rarity: "legendary", factions: ["chaotique", "cauchemar"] },
    { fileName: "Apsan.png", rarity: "legendary", factions: ["perceur"] },
    { fileName: "Aracha.png", rarity: "legendary", factions: ["perceur"] },
    { fileName: "Ardéa.png", rarity: "legendary", factions: ["chaotique", "nordiste"] },
    { fileName: "Arres.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Arrogance.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Calista.png", rarity: "legendary", factions: ["sentinelle"] },
    { fileName: "Cassiel.png", rarity: "legendary", factions: ["arbitre", "nordiste"] },
    { fileName: "Cerbeus.png", rarity: "legendary", factions: ["cultiste", "chaotique"] },
    { fileName: "Comte Dracula.png", rarity: "legendary", factions: ["chaotique", "perceur"] },
    { fileName: "Dane.png", rarity: "legendary", factions: ["sentinelle"] },
    { fileName: "Eldrr.png", rarity: "legendary", factions: ["nordiste"] },
    { fileName: "Ezareth.png", rarity: "legendary", factions: ["cultiste"] },
    { fileName: "Falcia.png", rarity: "legendary", factions: ["nordiste", "esoterique"] },
    { fileName: "Gisèle.png", rarity: "legendary", factions: ["chaotique", "cauchemar"] },
    { fileName: "Gretchen.png", rarity: "legendary", factions: ["chaotique", "cauchemar"] },
    { fileName: "Gul'Drak.png", rarity: "legendary", factions: ["chaotique", "infernal"] },
    { fileName: "Hélga.png", rarity: "legendary", factions: ["esoterique"] },
    { fileName: "Jeera.png", rarity: "legendary", factions: ["arbitre", "nordiste"] },
    { fileName: "Kane.png", rarity: "legendary", factions: ["arbitre", "nordiste"] },
    { fileName: "Kigiri.png", rarity: "legendary", factions: ["sentinelle", "cauchemar"] },
    { fileName: "Kinéza.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Lu Bu.png", rarity: "legendary", factions: ["chaotique", "nordiste"] },
    { fileName: "Lugaru.png", rarity: "legendary", factions: ["chaotique", "cauchemar"] },
    { fileName: "Luxure.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Magda.png", rarity: "legendary", factions: ["cultiste"] },
    { fileName: "Magmus.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Maw.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Nezha.png", rarity: "legendary", factions: ["sentinelle", "esoterique"] },
    { fileName: "Numéra.png", rarity: "legendary", factions: ["perceur", "esoterique"] },
    { fileName: "Phinéas.png", rarity: "legendary", factions: ["infernal"] },
    { fileName: "Rosalia.png", rarity: "legendary", factions: ["cultiste"] },
    { fileName: "Rygard.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Salazar.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Sélène.png", rarity: "legendary", factions: ["esoterique"] },
    { fileName: "Sergei.png", rarity: "legendary", factions: ["chaotique", "cauchemar"] },
    { fileName: "Sun Wukong.png", rarity: "legendary", factions: ["cauchemar", "sentinelle"] },
    { fileName: "Thalen.png", rarity: "legendary", factions: ["arbitre", "esoterique"] },
    { fileName: "Twyla.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Uredin.png", rarity: "legendary", factions: ["chaotique", "cultiste"] },
    { fileName: "Valdéron.png", rarity: "legendary", factions: ["chaotique"] },
    { fileName: "Valéria.png", rarity: "legendary", factions: ["chaotique", "cauchemar"] },
    { fileName: "Valkyra.png", rarity: "legendary", factions: ["nordiste", "arbitre"] },
    { fileName: "Volka.png", rarity: "legendary", factions: ["cauchemar"] },
    { fileName: "Xéna.png", rarity: "legendary", factions: ["infernal"] },
    { fileName: "Ymiret.png", rarity: "legendary", factions: ["innommable"] },
    { fileName: "Zilithu.png", rarity: "legendary", factions: ["infernal"] },
    { fileName: "Azhor.png", rarity: "legendary", factions: ["cauchemar"], roles: ["tank"] },
    { fileName: "Brokkir.png", rarity: "legendary", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Captain Rêve.png", rarity: "legendary", factions: ["cultiste"], roles: ["tank"] },
    { fileName: "Chevalier Arlott.png", rarity: "legendary", factions: ["cultiste", "infernal"], roles: ["tank"] },
    { fileName: "Constance.png", rarity: "legendary", factions: ["sentinelle", "arbitre"], roles: ["tank"] },
    { fileName: "Cyrus.png", rarity: "legendary", factions: ["esoterique"], roles: ["tank"] },
    { fileName: "Draelyn.png", rarity: "legendary", factions: ["sentinelle", "nordiste"], roles: ["tank"] },
    { fileName: "Edith.png", rarity: "legendary", factions: ["sentinelle"], roles: ["tank"] },
    { fileName: "Erlang Shen.png", rarity: "legendary", factions: ["arbitre", "perceur"], roles: ["tank"] },
    { fileName: "Ghan.png", rarity: "legendary", factions: ["chaotique"], roles: ["tank"] },
    { fileName: "Khadgrim.png", rarity: "legendary", factions: ["arbitre", "nordiste"], roles: ["tank"] },
    { fileName: "Krodor.png", rarity: "legendary", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Orim.png", rarity: "legendary", factions: ["infernal"], roles: ["tank"] },
    { fileName: "Régulus.png", rarity: "legendary", factions: ["sentinelle"], roles: ["tank"] },
    { fileName: "Roi Harz.png", rarity: "legendary", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Torodor.png", rarity: "legendary", factions: ["cauchemar"], roles: ["tank"] },
    { fileName: "Trusk.png", rarity: "legendary", factions: ["esoterique"], roles: ["tank"] },
    { fileName: "Akira.png", rarity: "legendary", factions: ["perceur", "nordiste"], roles: ["tireur"] },
    { fileName: "Alaura.png", rarity: "legendary", factions: ["sentinelle", "perceur"], roles: ["tireur"] },
    { fileName: "Calypso.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Crach.png", rarity: "legendary", factions: ["sentinelle"], roles: ["tireur"] },
    { fileName: "Dame Alexendra.png", rarity: "legendary", factions: ["arbitre", "perceur"], roles: ["tireur"] },
    { fileName: "Dr Van Helsing.png", rarity: "legendary", factions: ["perceur", "cauchemar"], roles: ["tireur"] },
    { fileName: "Fenris.png", rarity: "legendary", factions: ["nordiste"], roles: ["tireur"] },
    { fileName: "Hatssut.png", rarity: "legendary", factions: ["cauchemar"], roles: ["tireur"] },
    { fileName: "Hex.png", rarity: "legendary", factions: ["infernal", "perceur"], roles: ["tireur"] },
    { fileName: "Iovar.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Kai.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Lucius.png", rarity: "legendary", factions: ["sentinelle"], roles: ["tireur"] },
    { fileName: "Lynx.png", rarity: "legendary", factions: ["nordiste"], roles: ["tireur"] },
    { fileName: "Myca.png", rarity: "legendary", factions: ["infernal"], roles: ["tireur"] },
    { fileName: "Nyx.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Pelagios.png", rarity: "legendary", factions: ["arbitre", "perceur"], roles: ["tireur"] },
    { fileName: "Raizan.png", rarity: "legendary", factions: ["cauchemar"], roles: ["tireur"] },
    { fileName: "Razaak.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Ruen Hollow.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Sargak.png", rarity: "legendary", factions: ["chaotique", "perceur"], roles: ["tireur"] },
    { fileName: "Setram.png", rarity: "legendary", factions: ["infernal"], roles: ["tireur"] },
    { fileName: "Silas.png", rarity: "legendary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Sythra.png", rarity: "legendary", factions: ["chaotique", "perceur"], roles: ["tireur"] },
    { fileName: "Talinne.png", rarity: "legendary", factions: ["sentinelle", "perceur"], roles: ["tireur"] },
    { fileName: "Vorn.png", rarity: "legendary", factions: ["perceur", "esoterique"], roles: ["tireur"] },
    { fileName: "Yuri.png", rarity: "legendary", factions: ["cauchemar", "perceur"], roles: ["tireur"] },
    { fileName: "Ajax.png", rarity: "legendary", factions: ["innommable"], roles: ["mage"] },
    { fileName: "Alistair.png", rarity: "legendary", factions: ["arbitre", "sentinelle"], roles: ["mage"] },
    { fileName: "Anaï.png", rarity: "legendary", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Anora.png", rarity: "legendary", factions: ["cultiste", "esoterique"], roles: ["mage"] },
    { fileName: "Béatrix.png", rarity: "legendary", factions: ["cultiste", "esoterique"], roles: ["mage"] },
    { fileName: "Belzébuth.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Boréas.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Carosa.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Dahlia.png", rarity: "legendary", factions: ["cultiste", "esoterique"], roles: ["mage"] },
    { fileName: "Doubletronche.png", rarity: "legendary", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Durza.png", rarity: "legendary", factions: ["chaotique", "cultiste"], roles: ["mage"] },
    { fileName: "Ingrid.png", rarity: "legendary", factions: ["arbitre", "sentinelle"], roles: ["mage"] },
    { fileName: "Init.png", rarity: "legendary", factions: ["arbitre", "esoterique"], roles: ["mage"] },
    { fileName: "Kaede.png", rarity: "legendary", factions: ["esoterique", "chaotique"], roles: ["mage"] },
    { fileName: "Khamet.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Kria.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Laseer.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Lyra.png", rarity: "legendary", factions: ["infernal", "esoterique"], roles: ["mage"] },
    { fileName: "Malrik.png", rarity: "legendary", factions: ["infernal", "esoterique"], roles: ["mage"] },
    { fileName: "Morrigan.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Nocturne.png", rarity: "legendary", factions: ["nordiste", "infernal"], roles: ["mage"] },
    { fileName: "Nstya.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Praetus.png", rarity: "legendary", factions: ["arbitre"], roles: ["mage"] },
    { fileName: "Séréphine.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Shamir.png", rarity: "legendary", factions: ["nordiste"], roles: ["mage"] },
    { fileName: "Solcadens.png", rarity: "legendary", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Velisse.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Venoma.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Vierna.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Violetta Vane.png", rarity: "legendary", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Vixera.png", rarity: "legendary", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Xaris.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Zélus.png", rarity: "legendary", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Artémis.png", rarity: "legendary", factions: ["cultiste"], roles: ["heal"] },
    { fileName: "Aylin.png", rarity: "legendary", factions: ["infernal"], roles: ["heal"] },
    { fileName: "Corneline.png", rarity: "legendary", factions: ["chaotique", "cultiste"], roles: ["heal"] },
    { fileName: "Dassomi.png", rarity: "legendary", factions: ["chaotique", "esoterique"], roles: ["heal"] },
    { fileName: "Diaochan.png", rarity: "legendary", factions: ["sentinelle", "infernal"], roles: ["heal"] },
    { fileName: "Eirlys.png", rarity: "legendary", factions: ["sentinelle", "nordiste"], roles: ["heal"] },
    { fileName: "Elowyn.png", rarity: "legendary", factions: ["esoterique"], roles: ["heal"] },
    { fileName: "Eunomie.png", rarity: "legendary", factions: ["arbitre", "sentinelle"], roles: ["heal"] },
    { fileName: "Ezryn.png", rarity: "legendary", factions: ["esoterique"], roles: ["heal"] },
    { fileName: "Ferssi.png", rarity: "legendary", factions: ["infernal"], roles: ["heal"] },
    { fileName: "Gwendoline.png", rarity: "legendary", factions: ["nordiste"], roles: ["heal"] },
    { fileName: "Laya.png", rarity: "legendary", factions: ["sentinelle"], roles: ["heal"] },
    { fileName: "Lightlocke.png", rarity: "legendary", factions: ["sentinelle", "nordiste"], roles: ["heal"] },
    { fileName: "Nerissa.png", rarity: "legendary", factions: ["esoterique"], roles: ["heal"] },
    { fileName: "Nissandei.png", rarity: "epic", factions: ["perceur"], roles: ["heal"] },
    { fileName: "Sadie.png", rarity: "legendary", factions: ["nordiste"], roles: ["heal"] },
    { fileName: "Spring.png", rarity: "rare", factions: [], roles: ["heal"] },
    { fileName: "Talula.png", rarity: "legendary", factions: ["perceur"], roles: ["heal"] },
    { fileName: "Vortex.png", rarity: "epic", factions: ["nordiste"], roles: ["heal"] },
    { fileName: "Astraël.png", rarity: "legendary", factions: ["nordiste", "cauchemar"], roles: ["tacticien"] },
    { fileName: "Guan Yu.png", rarity: "legendary", factions: ["sentinelle", "nordiste"], roles: ["tacticien"] },
    { fileName: "Leikan.png", rarity: "legendary", factions: ["arbitre", "cauchemar"], roles: ["tacticien"] },
    { fileName: "Moriden.png", rarity: "legendary", factions: ["cauchemar", "esoterique"], roles: ["tacticien"] },
    { fileName: "Rivenhald.png", rarity: "legendary", factions: ["nordiste"], roles: ["tacticien"] },
    { fileName: "Valara.png", rarity: "legendary", factions: ["arbitre", "esoterique"], roles: ["tacticien"] },
    { fileName: "Vlad Draculea.png", rarity: "legendary", factions: ["cultiste"], roles: ["tacticien"] },
    { fileName: "Ain.png", rarity: "epic", factions: ["sentinelle"] },
    { fileName: "Atrox.png", rarity: "epic", factions: ["cultiste", "chaotique"] },
    { fileName: "Cram.png", rarity: "epic", factions: ["infernal"] },
    { fileName: "Cyclone.png", rarity: "epic", factions: ["esoterique"] },
    { fileName: "Cyrene.png", rarity: "epic", factions: ["sentinelle", "cultiste"] },
    { fileName: "Daline.png", rarity: "epic", factions: ["sentinelle"] },
    { fileName: "Deimos.png", rarity: "epic", factions: ["cauchemar"] },
    { fileName: "Démon.png", rarity: "epic", factions: ["cauchemar"] },
    { fileName: "Elysia.png", rarity: "epic", factions: ["arbitre"] },
    { fileName: "Estide.png", rarity: "epic", factions: ["nordiste"] },
    { fileName: "Fureur.png", rarity: "epic", factions: ["cauchemar"] },
    { fileName: "Gourmandise.png", rarity: "epic", factions: ["cauchemar"] },
    { fileName: "Janqhar.png", rarity: "epic", factions: ["esoterique"] },
    { fileName: "Komodo.png", rarity: "epic", factions: ["cauchemar"] },
    { fileName: "Rork.png", rarity: "epic", factions: ["nordiste"] },
    { fileName: "Vladov.png", rarity: "epic", factions: ["chaotique", "cauchemar"] },
    { fileName: "Voroth.png", rarity: "epic", factions: ["nordiste"] },
    { fileName: "Ardeth.png", rarity: "epic", factions: ["esoterique"], roles: ["tank"] },
    { fileName: "Aveline.png", rarity: "epic", factions: ["nordiste", "sentinelle"], roles: ["tank"] },
    { fileName: "Baron.png", rarity: "epic", factions: ["cauchemar"], roles: ["tank"] },
    { fileName: "Dayga.png", rarity: "epic", factions: ["cauchemar"], roles: ["tank"] },
    { fileName: "Isolde.png", rarity: "epic", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Jorge.png", rarity: "epic", factions: ["chaotique", "cultiste"], roles: ["tank"] },
    { fileName: "Livianne.png", rarity: "epic", factions: ["sentinelle", "perceur"], roles: ["tank"] },
    { fileName: "Malvira.png", rarity: "legendary", factions: ["nordiste", "cultiste"], roles: ["tank"] },
    { fileName: "Mériel.png", rarity: "epic", factions: ["sentinelle"], roles: ["tank"] },
    { fileName: "Olague.png", rarity: "epic", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Rhox.png", rarity: "epic", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Thunkles.png", rarity: "epic", factions: ["cultiste"], roles: ["tank"] },
    { fileName: "Titus.png", rarity: "epic", factions: ["infernal"], roles: ["tank"] },
    { fileName: "Brienne.png", rarity: "epic", factions: ["sentinelle", "perceur"], roles: ["tireur"] },
    { fileName: "Brunor.png", rarity: "epic", factions: ["nordiste", "infernal"], roles: ["tireur"] },
    { fileName: "Eliza.png", rarity: "epic", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Esmée.png", rarity: "epic", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Filippa.png", rarity: "epic", factions: ["esoterique"], roles: ["tireur"] },
    { fileName: "Harpun.png", rarity: "epic", factions: ["nordiste"], roles: ["tireur"] },
    { fileName: "Idril.png", rarity: "epic", factions: ["sentinelle", "perceur"], roles: ["tireur"] },
    { fileName: "Luneria.png", rarity: "epic", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Maul.png", rarity: "epic", factions: ["nordiste"], roles: ["tireur"] },
    { fileName: "Tazira.png", rarity: "epic", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Théowin.png", rarity: "epic", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Vargus.png", rarity: "epic", factions: ["chaotique", "perceur"], roles: ["tireur"] },
    { fileName: "Abyzou.png", rarity: "epic", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Ai.png", rarity: "epic", factions: ["esoterique", "nordiste"], roles: ["mage"] },
    { fileName: "Avarice.png", rarity: "epic", factions: ["cultiste", "cauchemar"], roles: ["mage"] },
    { fileName: "Azzoth.png", rarity: "epic", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Demi.png", rarity: "epic", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Eon.png", rarity: "epic", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Eona.png", rarity: "epic", factions: ["cultiste", "sentinelle"], roles: ["mage"] },
    { fileName: "Faelin.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Imani.png", rarity: "epic", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Kalina.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Laurelle.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Marri.png", rarity: "epic", factions: ["nordiste"], roles: ["mage"] },
    { fileName: "Nauvras.png", rarity: "epic", factions: ["cauchemar", "esoterique"], roles: ["mage"] },
    { fileName: "Nazeem.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Niro.png", rarity: "rare", factions: ["cultiste", "sentinelle"], roles: ["mage"] },
    { fileName: "Osiren.png", rarity: "epic", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Pierre.png", rarity: "legendary", factions: ["cultiste", "chaotique"], roles: ["mage"] },
    { fileName: "Pyros.png", rarity: "epic", factions: ["infernal"], roles: ["mage"] },
    { fileName: "Raiden.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Soleil.png", rarity: "epic", factions: ["sentinelle", "infernal"], roles: ["mage"] },
    { fileName: "Dolorès.png", rarity: "epic", factions: ["infernal"], roles: ["heal"] },
    { fileName: "Hollow.png", rarity: "epic", factions: ["cultiste"], roles: ["heal"] },
    { fileName: "Lili.png", rarity: "epic", factions: ["perceur", "esoterique"], roles: ["heal"] },
    { fileName: "Midan.png", rarity: "epic", factions: ["nordiste"], roles: ["heal"] },
    { fileName: "Barclay.png", rarity: "rare", factions: [] },
    { fileName: "Borut.png", rarity: "rare", factions: ["sentinelle"] },
    { fileName: "Décimus.png", rarity: "rare", factions: [] },
    { fileName: "Duradel.png", rarity: "rare", factions: [] },
    { fileName: "Gnash.png", rarity: "rare", factions: [] },
    { fileName: "Gogran.png", rarity: "rare", factions: [] },
    { fileName: "Narvi.png", rarity: "rare", factions: [] },
    { fileName: "Orgul.png", rarity: "rare", factions: [] },
    { fileName: "Rhutu.png", rarity: "rare", factions: [] },
    { fileName: "Shelor.png", rarity: "rare", factions: [] },
    { fileName: "Skulf.png", rarity: "rare", factions: [] },
    { fileName: "Barbe-Grise.png", rarity: "legendary", factions: ["esoterique"], roles: ["tank"] },
    { fileName: "Dagna.png", rarity: "rare", factions: ["nordiste"], roles: ["tank"] },
    { fileName: "Ghorza.png", rarity: "rare", factions: [], roles: ["tank"] },
    { fileName: "Glen.png", rarity: "rare", factions: [], roles: ["tank"] },
    { fileName: "Rex.png", rarity: "rare", factions: ["sentinelle"], roles: ["tank"] },
    { fileName: "Amahle.png", rarity: "rare", factions: [], roles: ["tireur"] },
    { fileName: "Cuke.png", rarity: "rare", factions: [], roles: ["tireur"] },
    { fileName: "Drogo.png", rarity: "rare", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Elukas.png", rarity: "rare", factions: ["cultiste"], roles: ["tireur"] },
    { fileName: "Morène.png", rarity: "rare", factions: ["infernal", "perceur"], roles: ["tireur"] },
    { fileName: "Dame Mina.png", rarity: "legendary", factions: ["nordiste", "perceur"], roles: ["mage"] },
    { fileName: "Glacius.png", rarity: "legendary", factions: ["nordiste"], roles: ["mage"] },
    { fileName: "Gonkba.png", rarity: "rare", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Nisalt.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Selkhat.png", rarity: "epic", factions: ["esoterique"], roles: ["mage"] },
    { fileName: "Sorzus.png", rarity: "rare", factions: ["cauchemar"], roles: ["mage"] },
    { fileName: "Voltus.png", rarity: "rare", factions: ["cultiste"], roles: ["mage"] },
    { fileName: "Aryn.png", rarity: "rare", factions: [], roles: ["heal"] },
    { fileName: "Automne.png", rarity: "rare", factions: ["infernal"], roles: ["heal"] },
    { fileName: "Camille.png", rarity: "rare", factions: ["sentinelle"], roles: ["heal"] },
    { fileName: "Nunéna.png", rarity: "rare", factions: [], roles: ["heal"] },
    { fileName: "Arlow.png", rarity: "ordinary", factions: [] },
    { fileName: "Halder.png", rarity: "ordinary", factions: [] },
    { fileName: "Hayden.png", rarity: "ordinary", factions: [] },
    { fileName: "Jonas.png", rarity: "ordinary", factions: [] },
    { fileName: "Ryder.png", rarity: "ordinary", factions: [] },
    { fileName: "Preter.png", rarity: "ordinary", factions: [], roles: ["tank"] },
    { fileName: "Rhumaleine.png", rarity: "ordinary", factions: [], roles: ["tank"] },
    { fileName: "Rogers.png", rarity: "ordinary", factions: [], roles: ["tank"] },
    { fileName: "Balafre.png", rarity: "ordinary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Liam.png", rarity: "ordinary", factions: ["perceur"], roles: ["tireur"] },
    { fileName: "Skreef.png", rarity: "ordinary", factions: [], roles: ["tireur"] },
    { fileName: "Wagrak.png", rarity: "ordinary", factions: [], roles: ["mage"] },
    { fileName: "Langlyn.png", rarity: "ordinary", factions: [], roles: ["heal"] },
    { fileName: "Lilia.png", rarity: "basic", factions: [] },
    { fileName: "Piquier.png", rarity: "basic", factions: [] },
    { fileName: "Gale.png", rarity: "basic", factions: [], roles: ["tireur"] },
    { fileName: "Josh.png", rarity: "basic", factions: [], roles: ["tireur"] },
];

const heroLayerCards = [...heroLayerData]
  .sort((left, right) => {
    const rarityDiff = heroRarityOrder.indexOf(left.rarity) - heroRarityOrder.indexOf(right.rarity);
    if (rarityDiff !== 0) return rarityDiff;
    return left.fileName.localeCompare(right.fileName, "fr", { sensitivity: "base" });
  })
  .map((hero, index) => {
    const name = hero.fileName.replace(/\.[^.]+$/, "");
    const owned = index % 5 !== 0;

    return {
      ...hero,
      id: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      image: calqueUrl("hero", hero.fileName),
      roles: hero.roles || ["combattant"],
      owned,
      awakening: owned ? index % 6 : 0,
    };
  });

function statusClass(status) {
  if (status === "pret" || status === "Actif") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "controle" || status === "A valider" || status === "attente") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
}

const LOGIN_IMAGE_SIZE = { width: 1672, height: 941 };
const LOGIN_HOTSPOTS = {
  email: { x: 642, y: 545, w: 390, h: 58 },
  password: { x: 642, y: 621, w: 318, h: 58 },
  eye: { x: 993, y: 632, w: 38, h: 34 },
  remember: { x: 590, y: 706, w: 205, h: 34 },
  rememberBox: { x: 590, y: 707, w: 22, h: 22 },
  forgot: { x: 900, y: 706, w: 165, h: 34 },
  submit: { x: 594, y: 753, w: 460, h: 73 },
};

function LoginPanel({ onLogin }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [viewport, setViewport] = useState(LOGIN_IMAGE_SIZE);
  const scrollRef = useRef(null);

  useEffect(() => {
    function updateViewport() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const fitScale = Math.min(
    viewport.width / LOGIN_IMAGE_SIZE.width,
    viewport.height / LOGIN_IMAGE_SIZE.height,
  );
  const imageScale =
    viewport.width < 768
      ? Math.max(0.68, Math.min(0.86, (viewport.height * 0.96) / LOGIN_IMAGE_SIZE.height))
      : Math.max(0.7, fitScale * 0.985);
  const stageWidth = Math.round(LOGIN_IMAGE_SIZE.width * imageScale);
  const stageHeight = Math.round(LOGIN_IMAGE_SIZE.height * imageScale);
  const stageOffsetX = Math.max((viewport.width - stageWidth) / 2, 0);
  const stageOffsetY = Math.max((viewport.height - stageHeight) / 2, 0);
  const loginFontSize = Math.min(Math.max(14, 21 * imageScale), 38);
  const pageWidth = Math.max(viewport.width, stageWidth + stageOffsetX * 2);
  const pageHeight = Math.max(viewport.height, stageHeight + stageOffsetY * 2);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (stageWidth > viewport.width) {
      container.scrollLeft = (stageWidth - viewport.width) / 2;
    }
    if (stageHeight > viewport.height) {
      container.scrollTop = Math.max((stageHeight - viewport.height) * 0.08, 0);
    }
  }, [stageHeight, stageWidth, viewport.height, viewport.width]);

  function hotspotStyle(area) {
    return {
      left: `${area.x * imageScale}px`,
      top: `${area.y * imageScale}px`,
      width: `${area.w * imageScale}px`,
      height: `${area.h * imageScale}px`,
    };
  }

  function fieldOverlayClass(field) {
    return [
      "pointer-events-none absolute flex items-center overflow-hidden rounded-md bg-[#030910]/95 px-0 font-serif text-left shadow-[inset_0_0_18px_rgba(0,0,0,0.72)]",
      focusedField === field ? "ring-2 ring-[#4fc3ff]/70" : "",
    ].join(" ");
  }

  function submit(event) {
    event.preventDefault();
    onLogin({
      name: "Arkhaos",
      watcherName: "Arkhaos",
      discordId: identifier.trim(),
      role: "Administrateur",
      guild: "Paladin",
    });
  }

  return (
    <main ref={scrollRef} className="relative h-[100svh] min-h-[100svh] overflow-auto bg-[#02060d] text-zinc-100">
      <h1 className="sr-only">Dashboard of Realms - Connexion</h1>

      <div
        className="relative"
        style={{
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          minWidth: "100%",
          minHeight: "100svh",
        }}
      >
        <div
          className="absolute overflow-hidden rounded-[10px] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_26px_90px_rgba(0,0,0,0.78)]"
          style={{
            left: `${stageOffsetX}px`,
            top: `${stageOffsetY}px`,
            width: `${stageWidth}px`,
            height: `${stageHeight}px`,
          }}
        >
          <img
            aria-hidden="true"
            src="/backgrounds/login-realms.png"
            alt=""
            className="absolute inset-0 h-full w-full select-none object-fill"
            draggable="false"
          />

      <form onSubmit={submit} className="absolute inset-0 z-10">
        <div
          aria-hidden="true"
          className={fieldOverlayClass("identifier")}
          style={{
            ...hotspotStyle(LOGIN_HOTSPOTS.email),
            fontSize: `${loginFontSize}px`,
          }}
        >
          <span className={identifier ? "truncate text-[#e6dccb]" : "truncate text-[#cabeab]/65"}>
            {identifier || "Identifiant"}
          </span>
        </div>
        <input
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          onFocus={() => setFocusedField("identifier")}
          onBlur={() => setFocusedField(null)}
          aria-label="Identifiant"
          autoComplete="username"
          className="absolute cursor-text opacity-0"
          style={hotspotStyle(LOGIN_HOTSPOTS.email)}
        />
        <div
          aria-hidden="true"
          className={fieldOverlayClass("password")}
          style={{
            ...hotspotStyle(LOGIN_HOTSPOTS.password),
            fontSize: `${loginFontSize}px`,
          }}
        >
          <span className={password ? "truncate text-[#e6dccb]" : "truncate text-[#cabeab]/65"}>
            {password ? (showPassword ? password : "\u2022".repeat(password.length)) : "Mot de passe"}
          </span>
        </div>
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField(null)}
          aria-label="Mot de passe"
          autoComplete="current-password"
          className="absolute cursor-text opacity-0"
          style={hotspotStyle(LOGIN_HOTSPOTS.password)}
        />
        <button
          type="button"
          onClick={() => setShowPassword((value) => !value)}
          aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          className="absolute rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.eye)}
        />
        <button
          type="button"
          onClick={() => setRemember((value) => !value)}
          aria-pressed={remember}
          className="absolute bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.remember)}
        >
          <span className="sr-only">Se souvenir de moi</span>
        </button>
        {remember && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-20 flex items-center justify-center border border-[#d8c5a9] bg-[#0a5c97]/85 text-[11px] font-bold text-white shadow-[0_0_10px_rgba(80,190,255,0.8)]"
            style={hotspotStyle(LOGIN_HOTSPOTS.rememberBox)}
          >
            {"\u2713"}
          </span>
        )}
        <button
          type="button"
          className="absolute bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.forgot)}
        >
          <span className="sr-only">Mot de passe oublie ?</span>
        </button>
        <button
          type="submit"
          className="absolute cursor-pointer bg-transparent outline-none transition focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/80"
          style={hotspotStyle(LOGIN_HOTSPOTS.submit)}
        >
          <span className="sr-only">Se connecter</span>
        </button>
      </form>
        </div>
      </div>
    </main>
  );
}

function ElectricBorderFilter() {
  return (
    <svg className="portal-electric-svg" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id="portal-electric-displace"
          colorInterpolationFilters="sRGB"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseA" seed="1" />
          <feOffset in="noiseA" dx="0" dy="0" result="offsetNoiseA">
            <animate attributeName="dy" values="700;0" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseB" seed="1" />
          <feOffset in="noiseB" dx="0" dy="0" result="offsetNoiseB">
            <animate attributeName="dy" values="0;-700" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseC" seed="2" />
          <feOffset in="noiseC" dx="0" dy="0" result="offsetNoiseC">
            <animate attributeName="dx" values="490;0" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseD" seed="2" />
          <feOffset in="noiseD" dx="0" dy="0" result="offsetNoiseD">
            <animate attributeName="dx" values="0;-490" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feComposite in="offsetNoiseA" in2="offsetNoiseB" result="verticalNoise" />
          <feComposite in="offsetNoiseC" in2="offsetNoiseD" result="horizontalNoise" />
          <feBlend in="verticalNoise" in2="horizontalNoise" mode="color-dodge" result="combinedNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="combinedNoise"
            scale="30"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </defs>
    </svg>
  );
}

function ElectricBorderLayers() {
  return (
    <div className="electric-border-container" aria-hidden="true">
      <div className="electric-inner-container">
        <div className="electric-border-outer">
          <div className="electric-main-border" />
        </div>
        <div className="electric-glow-layer-1" />
        <div className="electric-glow-layer-2" />
      </div>
      <div className="electric-overlay-1" />
      <div className="electric-overlay-2" />
      <div className="electric-background-glow" />
    </div>
  );
}

function PortalShell({ session, onLogout }) {
  const [active, setActive] = useState("home");

  const activeTitle = useMemo(() => {
    return navigation.find((item) => item.id === active)?.label || "Accueil";
  }, [active]);

  return (
    <div className="min-h-screen bg-[#11100d] text-zinc-100">
      <ElectricBorderFilter />
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-zinc-800 bg-zinc-950/95 px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10">
            <Compass className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <div className="font-semibold text-zinc-50">Paladin Control</div>
            <div className="text-xs text-zinc-500">GVG automation suite</div>
          </div>
        </div>

        <nav className="mt-8 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const selected = active === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActive(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  selected
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-5 left-4 right-4 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-100">{session.name}</div>
              <div className="text-xs text-zinc-500">{session.role}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title="Deconnexion"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-zinc-800 bg-[#11100d]/95 px-4 py-4 backdrop-blur md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm text-zinc-500">Portail</div>
              <h1 className="text-2xl font-semibold text-zinc-50">{activeTitle}</h1>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                API VPS prete
              </Badge>
              <Button variant="outline" className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800">
                <Bell className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main className="space-y-6 px-4 py-6 md:px-6">
          {active === "home" ? <HomeView session={session} setActive={setActive} /> : null}
          {active === "hero-box" ? <HeroBoxView /> : null}
          {active === "soul-stones" ? <SoulStonesTab session={session} /> : null}
          {active === "demon-monsters" ? <DemonMonstersTab session={session} /> : null}
          {active === "personal-best" ? <PersonalBestTab session={session} /> : null}
          {active === "defenses" ? <MyDefensesTab session={session} /> : null}
          {active === "gvg" ? <GvgView /> : null}
          {active === "launcher" ? <LauncherView /> : null}
          {active === "validation" ? <GvgValidationTab session={session} /> : null}
          {active === "templates" ? <TemplatesView /> : null}
          {active === "guilds" ? <GuildsView /> : null}
          {active === "billing" ? <BillingView /> : null}
          {active === "logs" ? <LogsView /> : null}
          {active === "settings" ? <SettingsView /> : null}
        </main>
      </div>
    </div>
  );
}

function HomeView({ session, setActive }) {
  const displayName = session.watcherName || session.name || "Joueur";
  const summaryCards = [
    { label: "Guilde", value: session.guild || "Paladin", icon: Users },
    { label: "Role", value: session.role || "Joueur", icon: Shield },
    { label: "Profil", value: "Non valide", icon: CheckCircle2 },
  ];

  return (
    <>
      <section
        className="electric-card player-home-card group relative min-h-[340px] overflow-hidden rounded-[1.35rem] border border-violet-500/70 bg-zinc-950 shadow-[0_0_34px_rgba(168,85,247,0.24)] transition-[border-color,box-shadow] duration-300 hover:border-violet-300/85 hover:shadow-[0_0_54px_rgba(168,85,247,0.48),0_30px_90px_rgba(0,0,0,0.58)] lg:h-[clamp(300px,24vw,380px)] lg:min-h-0"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(0,0,0,0.62), rgba(8,5,16,0.08) 44%, rgba(0,0,0,0.58)), url('/backgrounds/player-home-preview.png')",
          backgroundPosition: "center 42%",
          backgroundSize: "cover",
        }}
      >
        <ElectricBorderLayers />
        <div className="absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_42%,rgba(168,85,247,0.3),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.68))]" />
        <div className="relative z-10 grid min-h-[340px] gap-6 p-6 sm:p-8 lg:h-full lg:min-h-0 lg:grid-cols-[1fr_minmax(420px,0.78fr)] lg:items-end lg:p-[clamp(28px,2.4vw,42px)]">
          <div className="max-w-[620px] self-start lg:self-center">
            <p className="text-sm font-medium text-violet-200 sm:text-base">Accueil joueur</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.85)] sm:text-4xl lg:text-[2.35rem]">
              Bienvenue, {displayName}
            </h2>
            <p className="mt-4 max-w-[410px] text-sm leading-6 text-zinc-300 sm:text-base">
              Gerez vos outils, suivez vos activites et preparez vos batailles pour la gloire.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:gap-4">
            {summaryCards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.label}
                  className="relative min-h-[112px] cursor-default overflow-hidden rounded-xl border border-violet-400/55 bg-black/38 p-4 shadow-[inset_0_0_34px_rgba(0,0,0,0.72),0_0_18px_rgba(168,85,247,0.18)] backdrop-blur-[2px]"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-violet-300/80 shadow-[0_0_18px_4px_rgba(168,85,247,0.68)] opacity-75" />
                  <div className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-violet-400/60 shadow-[0_0_18px_4px_rgba(168,85,247,0.54)] opacity-65" />
                  <Icon className="h-5 w-5 text-zinc-200" />
                  <div className="mt-4 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-violet-300">
                    {card.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">{card.value}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {categoryCards.map((card) => {
          const Icon = card.icon;
          const canOpen = Boolean(card.target);
          const isProfile = card.id === "profile";
          const isHeroBox = card.id === "hero-box";
          const isSoulStone = card.id === "soul-stones";
          const isDemonMonsters = card.id === "demon-monsters";
          const isPersonalBest = card.id === "personal-best";
          const isDefenses = card.id === "defenses";
          const isImageCard = isProfile || isHeroBox || isSoulStone || isDemonMonsters || isPersonalBest || isDefenses;
          const imageHoverClass = isProfile
            ? "group-hover/profile:scale-[1.04]"
            : isSoulStone
              ? "group-hover/soulStone:scale-[1.04]"
              : isDemonMonsters
                ? "group-hover/demonMonsters:scale-[1.04]"
                : isPersonalBest
                  ? "group-hover/personalBest:scale-[1.04]"
                  : isDefenses
                    ? "group-hover/defenses:scale-[1.04]"
                    : "group-hover/heroBox:scale-[1.04]";
          const imageCardClass = isProfile
            ? "electric-card profile-category-card group/profile relative min-h-[200px] overflow-hidden rounded-lg border border-sky-400/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(14,165,233,0.16)] transition-[border-color,box-shadow,transform] duration-300 hover:border-sky-200/90 hover:shadow-[0_0_38px_rgba(56,189,248,0.42),0_18px_54px_rgba(2,8,23,0.72)]"
            : isSoulStone
              ? "electric-card soul-stone-category-card group/soulStone relative min-h-[200px] overflow-hidden rounded-lg border border-white/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(255,255,255,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-white/90 hover:shadow-[0_0_40px_rgba(255,255,255,0.45),0_18px_54px_rgba(15,23,42,0.74)]"
              : isDemonMonsters
                ? "electric-card demon-monsters-category-card group/demonMonsters relative min-h-[200px] overflow-hidden rounded-lg border border-red-500/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(239,68,68,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-orange-200/90 hover:shadow-[0_0_42px_rgba(239,68,68,0.48),0_18px_54px_rgba(24,2,2,0.78)]"
                : isPersonalBest
                  ? "electric-card personal-best-category-card group/personalBest relative min-h-[200px] overflow-hidden rounded-lg border border-emerald-500/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(16,185,129,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-emerald-200/90 hover:shadow-[0_0_42px_rgba(16,185,129,0.48),0_18px_54px_rgba(2,24,12,0.78)]"
                : isDefenses
  ? "electric-card defenses-category-card group/defenses relative min-h-[200px] overflow-hidden rounded-lg border border-pink-500/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(236,72,153,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-pink-200/90 hover:shadow-[0_0_42px_rgba(236,72,153,0.48),0_18px_54px_rgba(24,2,16,0.78)]"
  : "electric-card hero-box-category-card group/heroBox relative min-h-[200px] overflow-hidden rounded-lg border border-amber-300/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(245,158,11,0.16)] transition-[border-color,box-shadow,transform] duration-300 hover:border-yellow-100/90 hover:shadow-[0_0_40px_rgba(251,191,36,0.44),0_18px_54px_rgba(24,16,2,0.74)]";

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => canOpen && setActive(card.target)}
              className={
                isImageCard
                  ? imageCardClass
                  : "rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
              }
            >
              {isImageCard ? (
                <>
                  <ElectricBorderLayers />
                  <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                    <img
                      src={
                      isProfile
                        ? "/backgrounds/profile-card-preview.png"
                        : isSoulStone
                          ? "/backgrounds/soul-stone-card-preview.png"
                          : isDemonMonsters
                            ? "/backgrounds/demon-monsters-card-preview.png"
                            : isPersonalBest
                              ? "/backgrounds/personal-best-card-preview.png"
                              : isDefenses
                                ? "/backgrounds/defenses-card-preview.png"
                                : "/backgrounds/hero-box-card-preview.png"
                    }
                      alt=""
                      className={`h-full w-full object-cover object-center opacity-[0.92] transition duration-500 ${imageHoverClass}`}
                      draggable="false"
                    />
                    <div
                      className={
                        isProfile
                          ? "absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,0.88),rgba(2,8,23,0.38)_48%,rgba(2,8,23,0.06)),linear-gradient(180deg,rgba(2,8,23,0.04),rgba(2,8,23,0.82))]"
                          : "absolute inset-0 bg-[linear-gradient(90deg,rgba(24,16,2,0.88),rgba(24,16,2,0.38)_48%,rgba(24,16,2,0.05)),linear-gradient(180deg,rgba(24,16,2,0.02),rgba(24,16,2,0.84))]"
                      }
                    />
                  </div>
                  <div className="relative z-10 flex min-h-[200px] flex-col justify-end p-5">
                    <div
                      className={`inline-flex w-fit rounded-lg border p-2 ${
                        isProfile
                          ? card.tone
                          : "border-amber-300/35 bg-amber-300/10 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,0.18)]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div>
                        <div
                          className={`text-xs font-bold uppercase tracking-[0.18em] ${
                            isProfile ? "text-sky-200/85" : "text-amber-100/85"
                          }`}
                        >
                          {isProfile ? "Profil joueur" : "Heros"}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-zinc-50">{card.title}</div>
                        <p className="mt-2 max-w-[260px] text-sm leading-5 text-zinc-200/80">{card.description}</p>
                      </div>
                      <ChevronRight className={`h-4 w-4 ${isProfile ? "text-sky-100" : "text-amber-100"}`} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={`inline-flex rounded-lg border p-2 ${card.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-base font-semibold text-zinc-50">{card.title}</div>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </>
              )}
            </button>
          );
        })}
      </section>
    </>
  );
}

function HeroBoxView() {
  const [query, setQuery] = useState("");
  const [ownedFilter, setOwnedFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [factionFilter, setFactionFilter] = useState("all");
  const [heroStates, setHeroStates] = useState(() =>
    Object.fromEntries(heroLayerCards.map((hero) => [hero.id, { owned: hero.owned, awakening: hero.awakening }])),
  );

  const visibleHeroes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return heroLayerCards.filter((hero) => {
      const state = heroStates[hero.id] || { owned: false, awakening: 0 };
      const matchesQuery = normalizedQuery.length === 0 || hero.name.toLowerCase().includes(normalizedQuery);
      const matchesState =
        ownedFilter === "all" ||
        (ownedFilter === "owned" && state.owned) ||
        (ownedFilter === "locked" && !state.owned);
      const matchesRarity = rarityFilter === "all" || hero.rarity === rarityFilter;
      const matchesRole = roleFilter === "all" || hero.roles.includes(roleFilter);
      const matchesFaction = factionFilter === "all" || hero.factions.includes(factionFilter);

      return matchesQuery && matchesState && matchesRarity && matchesRole && matchesFaction;
    });
  }, [factionFilter, heroStates, ownedFilter, query, rarityFilter, roleFilter]);

  const stats = useMemo(() => {
    const values = Object.values(heroStates);
    const owned = values.filter((state) => state.owned).length;
    const a5 = values.filter((state) => state.owned && state.awakening === 5).length;
    const awakening = values.reduce((total, state) => total + (state.owned ? state.awakening : 0), 0);

    return { owned, a5, awakening };
  }, [heroStates]);

  function unlockHero(heroId) {
    setHeroStates((current) => ({
      ...current,
      [heroId]: {
        owned: true,
        awakening: current[heroId]?.awakening || 0,
      },
    }));
  }

  function setAwakening(heroId, level) {
    setHeroStates((current) => {
      const currentState = current[heroId] || { owned: false, awakening: 0 };
      const nextAwakening = level === 1 && currentState.awakening === 1 ? 0 : level;

      return {
        ...current,
        [heroId]: {
          owned: true,
          awakening: nextAwakening,
        },
      };
    });
  }

  return (
    <section className="hero-box-page">
      <div className="hero-box-panel">
        <div className="hero-box-heading">
          <div>
            <div className="hero-box-eyebrow">Watcher of Realms</div>
            <h2>Ma box heros</h2>
            <p>
              Test de viabilite avec tes calques. Le visuel de carte reste dans l'image, et les etoiles d'eveil sont
              superposees en bas de la vignette.
            </p>
          </div>
          <div className="hero-box-stats" aria-label="Statistiques de collection">
            <div>
              <span>Possedes</span>
              <strong>{stats.owned}/{heroLayerCards.length}</strong>
            </div>
            <div>
              <span>Eveils</span>
              <strong>{stats.awakening}</strong>
            </div>
            <div>
              <span>A5</span>
              <strong>{stats.a5}</strong>
            </div>
          </div>
        </div>

        <div className="hero-box-toolbar">
          <label className="hero-box-search">
            <Search className="h-4 w-4" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un heros"
              aria-label="Rechercher un heros"
            />
          </label>

          <div className="hero-box-filter-group" aria-label="Filtrer les heros">
            {[
              ["all", "Tous"],
              ["owned", "Possedes"],
              ["locked", "Verrouilles"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={ownedFilter === id}
                onClick={() => setOwnedFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="hero-box-filter-row" aria-label="Filtres de rarete">
          {heroRarityFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="hero-rarity-filter"
              style={{ "--rarity-color": filter.color }}
              aria-pressed={rarityFilter === filter.id}
              onClick={() => setRarityFilter(filter.id)}
            >
              <span className="hero-rarity-dot" />
              {filter.label}
            </button>
          ))}
        </div>

        <div className="hero-box-icon-filter-grid">
          <div className="hero-box-icon-filters" aria-label="Filtres de roles">
            {heroRoleFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="hero-icon-filter"
                aria-label={filter.label}
                title={filter.label}
                aria-pressed={roleFilter === filter.id}
                onClick={() => setRoleFilter(filter.id)}
              >
                {filter.image ? <img src={filter.image} alt="" draggable="false" /> : <span>Tous</span>}
              </button>
            ))}
          </div>

          <div className="hero-box-icon-filters" aria-label="Filtres de factions">
            {heroFactionFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="hero-icon-filter"
                aria-label={filter.label}
                title={filter.label}
                aria-pressed={factionFilter === filter.id}
                onClick={() => setFactionFilter(filter.id)}
              >
                {filter.image ? <img src={filter.image} alt="" draggable="false" /> : <span>Toutes</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="hero-box-result-count">
          {visibleHeroes.length} heros affiches
        </div>

        <div className="hero-layer-grid">
          {visibleHeroes.map((hero) => (
            <HeroLayerCard
              key={hero.id}
              hero={hero}
              state={heroStates[hero.id] || { owned: false, awakening: 0 }}
              onUnlock={unlockHero}
              onAwakening={setAwakening}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function HeroLayerCard({ hero, state, onUnlock, onAwakening }) {
  return (
    <article className={`hero-layer-card ${state.owned ? "is-owned" : "is-locked"}`}>
      <img src={hero.image} alt={hero.name} loading="lazy" decoding="async" draggable="false" />

      {!state.owned ? (
        <button
          type="button"
          className="hero-layer-lock"
          aria-label={`Marquer ${hero.name} comme possede`}
          onClick={() => onUnlock(hero.id)}
        >
          <Lock className="h-7 w-7" />
        </button>
      ) : null}

      <div className="hero-layer-stars" aria-label={`${hero.name} eveil A${state.awakening}`}>
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            type="button"
            className={state.owned && state.awakening >= level ? "is-active" : ""}
            aria-label={`Regler ${hero.name} en eveil ${level}`}
            disabled={!state.owned}
            onClick={() => onAwakening(hero.id, level)}
          >
            <Star className="h-full w-full" />
          </button>
        ))}
      </div>

      <div className="hero-layer-name">
        <strong>{hero.name}</strong>
      </div>
    </article>
  );
}

function GvgView() {
  const [activeGvgView, setActiveGvgView] = useState("current");

  const views = [
    { id: "current", label: "GVG en cours" },
    { id: "panel", label: "Pilotage" },
    { id: "admin", label: "Imports VPS" },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 p-2">
        {views.map((view) => {
          const selected = activeGvgView === view.id;

          return (
            <button
              key={view.id}
              type="button"
              onClick={() => setActiveGvgView(view.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "bg-violet-500/20 text-violet-100 shadow-[0_0_18px_rgba(168,85,247,0.22)]"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              {view.label}
            </button>
          );
        })}
      </div>

      {activeGvgView === "current" ? <GvgCurrentTab /> : null}
      {activeGvgView === "panel" ? <GvgPanelTab /> : null}
      {activeGvgView === "admin" ? <GvgAdminTab /> : null}
    </section>
  );
}

function LauncherView() {
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">Agent Windows</h2>
        <p className="mt-1 text-sm text-zinc-500">Etat du futur launcher local connecte au serveur.</p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ["Hors ligne", XCircle, "border-red-500/25 bg-red-500/10 text-red-300"],
            ["Derniere calibration", Clock3, "border-amber-500/25 bg-amber-500/10 text-amber-300"],
            ["Commandes temporaires", Shield, "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"],
          ].map(([label, Icon, classes]) => (
            <div key={label} className={`rounded-lg border p-4 ${classes}`}>
              <Icon className="h-5 w-5" />
              <div className="mt-3 font-medium">{label}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium text-zinc-100">Mission test</div>
              <div className="text-sm text-zinc-500">Calibration plein ecran puis retour serveur.</div>
            </div>
            <Button className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-500">
              <UploadCloud className="mr-2 h-4 w-4" />
              Preparer
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-lg font-semibold text-zinc-50">Regles de securite</h2>
        <div className="mt-4 space-y-3 text-sm text-zinc-400">
          {["Fenetre du jeu au premier plan", "Arret si la souris bouge", "Session expiree apres mission", "Aucune logique complete stockee"].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ValidationView() {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Validation des defenses</h2>
          <p className="mt-1 text-sm text-zinc-500">Previews compressees, JSON min et corrections manuelles.</p>
        </div>
        <Badge className="rounded-lg border-sky-500/30 bg-sky-500/10 text-sky-300">48/48 exemple</Badge>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-2">
          {["Bastion 1", "Bastion 2", "Bastion 3", "Bastion 4"].map((bastion, index) => (
            <button key={bastion} type="button" className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:bg-zinc-800">
              <span className="font-medium text-zinc-100">{bastion}</span>
              <Badge className={`rounded-md ${index === 0 ? statusClass("pret") : statusClass("attente")}`}>
                {index === 0 ? "valide" : "a controler"}
              </Badge>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="aspect-video rounded-lg border border-zinc-800 bg-[linear-gradient(135deg,#1d1b16,#0f1720_45%,#132018)]" />
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {["Torodor", "Eirlys", "Venoma", "Hex", "Praetus"].map((hero, index) => (
              <div key={hero} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
                <div className="font-medium text-zinc-100">{hero}</div>
                <div className="mt-1 text-zinc-500">E{index + 1} - {["N", "S", "E", "O", "S"][index]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TemplatesView() {
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">Templates heros</h2>
        <p className="mt-1 text-sm text-zinc-500">Espace admin prevu pour ajouter un heros et tester son matching.</p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {["Upload template", "Test sur captures", "Publication serveur"].map((label, index) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm text-zinc-500">Etape {index + 1}</div>
              <div className="mt-2 font-medium text-zinc-100">{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-lg font-semibold text-zinc-50">A surveiller</h2>
        <div className="mt-4 space-y-3">
          {["Suffixes normalises", "Doublons visuels", "Score minimum", "Sens des fleches"].map((item) => (
            <div key={item} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300">
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GuildsView() {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-xl font-semibold text-zinc-50">Guildes</h2>
      <div className="mt-5 overflow-hidden rounded-lg border border-zinc-800">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-400">
          <div>Nom</div>
          <div>Plan</div>
          <div>GVG</div>
          <div>Etat</div>
        </div>
        {guildRows.map((row) => (
          <div key={row.name} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] border-t border-zinc-800 px-4 py-3 text-sm">
            <div className="font-medium text-zinc-100">{row.name}</div>
            <div className="text-zinc-400">{row.plan}</div>
            <div className="text-zinc-400">{row.gvg}</div>
            <div>
              <Badge className={`rounded-md ${statusClass(row.status)}`}>{row.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function BillingView() {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {["Interne", "Guilde externe", "Entreprise"].map((plan, index) => (
        <div key={plan} className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
          <div className="text-sm text-zinc-500">Plan</div>
          <div className="mt-1 text-xl font-semibold text-zinc-50">{plan}</div>
          <div className="mt-4 text-3xl font-semibold text-zinc-50">{index === 0 ? "0" : index === 1 ? "19" : "49"} EUR</div>
          <div className="mt-2 text-sm text-zinc-500">par mois</div>
        </div>
      ))}
    </section>
  );
}

function LogsView() {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-xl font-semibold text-zinc-50">Journal systeme</h2>
      <div className="mt-5 space-y-2 font-mono text-sm">
        {[
          "[20:50:41] reco exitCode=0",
          "[20:50:42] previews generated=48",
          "[20:50:44] site_payload.json ready",
          "[20:51:00] waiting for validation",
        ].map((line) => (
          <div key={line} className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-300">
            {line}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView() {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <h2 className="text-xl font-semibold text-zinc-50">Parametres</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {["Connexion Supabase", "API VPS", "Retention images", "Roles utilisateurs"].map((item) => (
          <div key={item} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="font-medium text-zinc-100">{item}</div>
            <div className="mt-1 text-sm text-zinc-500">A connecter dans une prochaine iteration.</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function SaasPortal() {
  const [session, setSession] = useState(null);

  if (!session) {
    return <LoginPanel onLogin={setSession} />;
  }

  return <PortalShell session={session} onLogout={() => setSession(null)} />;
}
