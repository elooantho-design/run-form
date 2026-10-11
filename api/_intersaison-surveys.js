import { Buffer } from "node:buffer";

export const INTERSAISON_SURVEY_SEASONS_TABLE = "intersaison_survey_seasons";
export const INTERSAISON_SURVEY_CAMPAIGNS_TABLE = "intersaison_survey_campaigns";
export const INTERSAISON_SURVEY_RECIPIENTS_TABLE = "intersaison_survey_recipients";
export const INTERSAISON_SURVEY_RESPONSES_TABLE = "intersaison_survey_responses";
export const INTERSAISON_SURVEY_GUILD_OBJECTIVES_TABLE = "intersaison_survey_guild_objectives";

export const INTERSAISON_SURVEY_ONE_DEFAULT_MESSAGE = `⚔️ Cluster Paladin — Préparation de la prochaine saison

Bonjour !

Nous commençons à préparer la prochaine saison et, avant de définir les objectifs des différentes guildes du cluster, nous souhaitons recueillir ton avis.

Attention : ce message n'est pas encore le sondage d'inter-saison qui déterminera ta future guilde.

Le sondage d'affectation viendra dans un second temps.

Pour préparer celui-ci, nous souhaitons comprendre tes ambitions, tes attentes et l'environnement dans lequel tu aimerais évoluer la saison prochaine.

L'objectif est de construire les futurs objectifs de nos guildes à partir des envies des joueurs, plutôt que de vous imposer des orientations décidées à l'avance.

Quel objectif aimerais-tu que ta guilde poursuive la saison prochaine, et dans quel environnement souhaiterais-tu évoluer pour prendre plaisir à jouer ?

Tu peux répondre librement, en quelques mots ou en développant ta réflexion.

Merci pour ta participation !`;

export const INTERSAISON_SURVEY_STATES = Object.freeze([
  "inactive",
  "survey1_preparing",
  "survey1_open",
  "survey1_closed",
  "survey2_preparing",
  "survey2_open",
  "survey2_closed",
  "finished",
]);

export const INTERSAISON_SURVEY_CAMPAIGN_STATUSES = Object.freeze([
  "preparing",
  "open",
  "closed",
  "cancelled",
]);

export const INTERSAISON_SURVEY_DM_INTERACTION_OBJECTIVES = "intersaison_objectives";

export function cleanSurveyText(value) {
  return String(value || "").trim();
}

export function normalizeSurveyGuildCode(value) {
  return cleanSurveyText(value).replace(/\s+/g, " ");
}

export function normalizeSurveyPollNumber(value) {
  const number = Number(value);
  return number === 2 ? 2 : 1;
}

export function getSurveyPollLabel(pollNumber) {
  return normalizeSurveyPollNumber(pollNumber) === 2
    ? "Sondage 2 — Choix de guilde"
    : "Sondage 1 — Consultation des objectifs";
}

export function getSurveyStateLabel(state, pollNumber = 1) {
  const cleanState = cleanSurveyText(state);
  if (!cleanState || cleanState === "inactive") return "Aucune inter-saison active";
  if (cleanState === "finished") return "Inter-saison terminée";
  if (cleanState === `survey${pollNumber}_preparing`) return `${getSurveyPollLabel(pollNumber)} — En préparation`;
  if (cleanState === `survey${pollNumber}_open`) return `${getSurveyPollLabel(pollNumber)} — En cours`;
  if (cleanState === `survey${pollNumber}_closed`) return `${getSurveyPollLabel(pollNumber)} — Clôturé`;
  return cleanState.replace(/_/g, " ");
}

export function getSurveyMemberDeliveryStatus({ surveyRecipient = null, dmRecipient = null, response = null } = {}) {
  if (response?.responded_at || response?.respondedAt || surveyRecipient?.responded_at) {
    return {
      color: "green",
      status: "responded",
      label: "Réponse enregistrée",
      detail: "Réponse enregistrée",
    };
  }

  const explicitStatus = cleanSurveyText(surveyRecipient?.delivery_status || surveyRecipient?.deliveryStatus);
  const dmStatus = cleanSurveyText(dmRecipient?.status);
  const status = dmStatus || explicitStatus || "not_included";

  if (!surveyRecipient || status === "not_included") {
    return {
      color: "neutral",
      status: "not_included",
      label: "Non inclus",
      detail: "Aucune campagne lancée ou joueur non inclus",
    };
  }

  if (status === "sent") {
    return {
      color: "orange",
      status: "sent",
      label: "Envoyé",
      detail: "MP envoyé, réponse non reçue",
    };
  }

  if (status === "confirmed") {
    return {
      color: "orange",
      status: "confirmed",
      label: "Réponse absente",
      detail: "Confirmation Discord reçue, mais aucune réponse enregistrée",
    };
  }

  if (["queued", "sending"].includes(status)) {
    return {
      color: "red",
      status,
      label: status === "sending" ? "Envoi en cours" : "En file",
      detail: status === "sending" ? "Message en cours d'envoi" : "Message en attente d'envoi",
    };
  }

  if (["failed", "missing_invalid", "excluded_duplicate"].includes(status)) {
    return {
      color: "red",
      status,
      label:
        status === "missing_invalid"
          ? "ID Discord manquant"
          : status === "excluded_duplicate"
            ? "Doublon Discord"
            : "Échec d'envoi",
      detail:
        surveyRecipient?.last_error ||
        surveyRecipient?.lastError ||
        dmRecipient?.last_error ||
        dmRecipient?.lastError ||
        "Message non remis",
    };
  }

  return {
    color: "neutral",
    status,
    label: "Non inclus",
    detail: "Statut non déterminé",
  };
}

export function buildSurveyGuildCards({
  guilds = [],
  members = [],
  surveyRecipients = [],
  dmRecipients = [],
  responses = [],
} = {}) {
  const recipientsByMemberId = new Map(
    (surveyRecipients || []).filter((row) => row?.member_id).map((row) => [String(row.member_id), row]),
  );
  const dmRecipientsById = new Map(
    (dmRecipients || []).filter((row) => row?.id).map((row) => [String(row.id), row]),
  );
  const responsesByRecipientId = new Map(
    (responses || [])
      .filter((row) => row?.survey_recipient_id || row?.surveyRecipientId)
      .map((row) => [String(row.survey_recipient_id || row.surveyRecipientId), row]),
  );

  return (guilds || []).map((guild) => {
    const guildCode = normalizeSurveyGuildCode(guild?.guild_code || guild?.guildCode);
    const guildMembers = (members || [])
      .filter((member) => normalizeSurveyGuildCode(member?.guild_code || member?.guildCode) === guildCode)
      .sort((left, right) =>
        String(left?.watcher_name || "").localeCompare(String(right?.watcher_name || ""), "fr", {
          sensitivity: "base",
        }),
      )
      .map((member) => {
        const surveyRecipient = recipientsByMemberId.get(String(member.id)) || null;
        const dmRecipient = surveyRecipient?.guild_dm_recipient_id
          ? dmRecipientsById.get(String(surveyRecipient.guild_dm_recipient_id)) || null
          : null;
        const response = surveyRecipient?.id ? responsesByRecipientId.get(String(surveyRecipient.id)) || null : null;
        const delivery = getSurveyMemberDeliveryStatus({ surveyRecipient, dmRecipient, response });
        return {
          id: member.id,
          watcherName: member.watcher_name || "",
          discordId: member.discord_id || "",
          guildCode,
          surveyRecipient,
          dmRecipient,
          response,
          delivery,
        };
      });

    const targeted = guildMembers.filter((member) => member.surveyRecipient).length;
    const responded = guildMembers.filter((member) => member.delivery.color === "green").length;

    return {
      guild,
      guildCode,
      displayName: guild?.display_name || guild?.displayName || guildCode,
      totalMembers: guildMembers.length,
      targeted,
      responded,
      members: guildMembers,
    };
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSheetName(value, fallback) {
  const name = String(value || fallback || "Sheet")
    .replace(/[\\:*?/]/g, " ")
    .replace(/\[/g, " ")
    .replace(/\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (name || fallback || "Sheet").slice(0, 31);
}

function getColumnName(index) {
  let current = Number(index) + 1;
  let name = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function buildSheetXml(rows = []) {
  const safeRows = rows.length ? rows : [[""]];
  const sheetRows = safeRows
    .map((row, rowIndex) => {
      const cells = (row || [])
        .map((cell, cellIndex) => {
          const ref = `${getColumnName(cellIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
}

function buildWorkbookXml(sheets) {
  const sheetEntries = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escapeXml(sanitizeSheetName(sheet.name, `Sheet ${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetEntries}</sheets>
</workbook>`;
}

function buildWorkbookRelsXml(sheets) {
  const worksheetRels = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRels}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildContentTypesXml(sheets) {
  const worksheetTypes = sheets
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${worksheetTypes}
</Types>`;
}

const XLSX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

let crc32Table = null;

function getCrc32Table() {
  if (crc32Table) return crc32Table;
  crc32Table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  return crc32Table;
}

function crc32(buffer) {
  const table = getCrc32Table();
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function getDosDateTime(date = new Date()) {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(1980, safeDate.getFullYear());
  const dosTime =
    (safeDate.getHours() << 11) |
    (safeDate.getMinutes() << 5) |
    Math.floor(safeDate.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate();
  return { dosTime, dosDate };
}

function createZipEntry(name, content, offset) {
  const nameBuffer = Buffer.from(name, "utf8");
  const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  const checksum = crc32(contentBuffer);
  const { dosTime, dosDate } = getDosDateTime();
  const flags = 0x0800;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(flags, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(dosTime, 10);
  localHeader.writeUInt16LE(dosDate, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(contentBuffer.length, 18);
  localHeader.writeUInt32LE(contentBuffer.length, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(flags, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(dosTime, 12);
  centralHeader.writeUInt16LE(dosDate, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(contentBuffer.length, 20);
  centralHeader.writeUInt32LE(contentBuffer.length, 24);
  centralHeader.writeUInt16LE(nameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(offset, 42);

  const local = Buffer.concat([localHeader, nameBuffer, contentBuffer]);
  const central = Buffer.concat([centralHeader, nameBuffer]);
  return { local, central };
}

export function buildSurveyResponsesWorkbook(sheets = []) {
  const safeSheets = (sheets || []).length ? sheets : [{ name: "Export", rows: [["Aucune donnée"]] }];
  const files = [
    { name: "[Content_Types].xml", content: buildContentTypesXml(safeSheets) },
    { name: "_rels/.rels", content: XLSX_ROOT_RELS },
    { name: "xl/workbook.xml", content: buildWorkbookXml(safeSheets) },
    { name: "xl/_rels/workbook.xml.rels", content: buildWorkbookRelsXml(safeSheets) },
    { name: "xl/styles.xml", content: XLSX_STYLES },
    ...safeSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: buildSheetXml(sheet.rows || []),
    })),
  ];

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const entry = createZipEntry(file.name, file.content, offset);
    locals.push(entry.local);
    centrals.push(entry.central);
    offset += entry.local.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}

export function isMissingIntersaisonSurveySchema(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(INTERSAISON_SURVEY_SEASONS_TABLE) ||
    message.includes(INTERSAISON_SURVEY_CAMPAIGNS_TABLE) ||
    message.includes(INTERSAISON_SURVEY_RECIPIENTS_TABLE) ||
    message.includes(INTERSAISON_SURVEY_RESPONSES_TABLE) ||
    message.includes(INTERSAISON_SURVEY_GUILD_OBJECTIVES_TABLE) ||
    message.includes("could not find the table")
  );
}
