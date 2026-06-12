# O&M予定表 UIオーバーホール — 統合実装仕様書

対象リポジトリ: `C:\Users\田中　圭亮\Desktop\Claude_Code_Demo\58_construction-schedule\.claude\worktrees\tender-montalcini-1059e4`
（以下、ファイルパスは `src/...` 等の相対表記。すべて上記ルート配下）

## 0. 統合方針と主要な設計判断

上司フィードバック「使いやすい・見やすい・操作しやすい / Outlookに寄せる / テーマ切替」を3本柱に分解:

1. **テーマ基盤**（CSS変数トークン + light/dark切替）— 全項目の前提なので最初
2. **視認性**（ソリッドイベントチップ / 営業時間外シェーディング / 人軸の列幅）
3. **操作効率**（ツールバー3段→1段 / フィルター永続化 / 重複ナビ削除）

3案の統合で解決したコンフリクト（採否と理由）:

| 論点 | 採用 | 却下 | 理由 |
|------|------|------|------|
| 仮（未送信）予定の塗り | **同期済=ソリッド / 仮=濃いめtint+破線+ハッチ**（案2） | 全部ソリッド+白ハッチ（案1） | 仮/✓は業務上の安全シグナル。塗り方の対比は8pxバッジよりはるかに視認性が高く、白ストライプは明色（#F59E0B）で消えるリスクもある |
| イベント色の実装 | **CSSクラス `.event-solid`/`.event-tint`/`.event-neutral` + `--mc`変数 + color-mix**（案3） | JS内hex連結のまま色分岐 | テーマ条件分岐をJSから排除し、ライト/ダークが1箇所で完結。将来の調整もCSSのみ |
| メンバーフィルターUI | **ツールバー内ポップオーバー**（案2） | Sidebar「My Calendars」リスト（案1） | 挙動変更が小さくモバイル（off-canvas drawer）でも動線が変わらない。Sidebarリスト化はPHASE-2の任意項目に降格 |
| 営業時間外シェーディング | **絶対配置の帯2本（pointer-events-none）**（案2） | 時間セルごとのbgクラス分岐（案1） | dragOverハイライト（セル自身のbg）と干渉しない。セル単位の条件分岐よりレンダリングコストも低い |
| ダークパレット | **Outlook/Fluent系ニュートラル**（#1B1A19/#252423、案1） | 青み系（#1B2433、案3） | 「Outlookに寄せる」要望への忠実性。構造（color-scheme、FOUCガード等）は案3を採用 |
| テーマ既定値 | **`'light'`**（3択 ライト/ダーク/システム は提供） | `'system'` 既定 | PHASE-1ではモーダル群が未移行のため、デプロイ直後にOSダークのユーザーへ未完成のダークを見せない。オプトイン方式 |
| 現在時刻ライン | グリッドレベル1本化はせず**今日列のみ2px線+ガター時刻チップ** | 全幅赤線（案2） | 日付軸では「今日」以外の列に線が走るのは意味的に誤り。Outlookも今日列のみ |

**注意: メンバーは10名ではなく11エントリ**（`src/data/members.js` に `delivery`（納品, #D97706）疑似メンバーが含まれる）。フィルターUI・全選択判定は `MEMBERS.length`(=11) / `MEMBER_ORDER` 基準で実装すること。

実測: ハードコードされたニュートラル系クラス（bg/text/border/ring-white|gray|slate）は計約320箇所。内訳: WeeklyView 61 / EventDetailModal 46 / SettingsView 32 / AssignModal 30 / JobPanel 28 / DailyView 25 / Header 21 / MonthlyView 20 / QuickAddModal 19 / JobCard 11 / LoginGate 10 / EventBlock 8 / Sidebar 4 / App 4 / MainLayout 1。

---

# PHASE-1（今やる。実装順 = 依存順 × impact/effort）

## P1-1. テーマトークン基盤（index.css 全面書き換え）【S / 全項目の前提】

**ファイル**: `src/index.css`

現在の20行を以下で**全置換**（そのまま貼り付け可）。既存 `--color-primary*` は未使用（grep確認済み）のため削除。`--sidebar-width` も未使用だが互換のため残す。

```css
@import "tailwindcss";

/* dark: variant を prefers-color-scheme ではなく data 属性に再バインド
   （@import 直後・トップレベル必須。位置を間違えるとビルドエラー） */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  color-scheme: light; /* ネイティブ date/time input・checkbox がテーマ追従 */
  /* surfaces */
  --canvas: #F5F5F5;          /* ページ背景 (旧 bg-gray-50) */
  --surface: #FFFFFF;         /* カード・グリッド・パネル (旧 bg-white) */
  --raised: #FFFFFF;          /* sticky ヘッダー・時刻ガター・モーダル・ポップオーバー */
  --surface-hover: #F3F2F1;   /* hover 行/スロット */
  /* lines */
  --edge: #E1DFDD;            /* コンポーネント境界 (旧 border-gray-200/300) */
  --grid-line: #EDEBE9;       /* 時間罫線 (旧 border-gray-100) */
  --grid-line-faint: #F5F4F2; /* 30分罫線 (旧 border-gray-50) */
  /* text */
  --ink: #242424;             /* 主文字 (旧 text-gray-700/800) */
  --ink-muted: #616161;       /* 副文字 (旧 text-gray-500/600) */
  --ink-faint: #9E9E9E;       /* ヒント・時刻ラベル (旧 text-gray-300/400) */
  /* accent — Outlook/Fluent blue */
  --accent: #0F6CBD;
  --accent-fill: #0F6CBD;     /* ベタ塗りアクセント（上に白文字） */
  --accent-soft: #EBF3FC;     /* 今日ヘッダー背景 (旧 bg-blue-50) */
  /* calendar shading */
  --today-bg: rgba(15, 108, 189, .05);
  --weekend-bg: rgba(96, 94, 92, .07);
  --offhours-bg: rgba(96, 94, 92, .07); /* 営業時間外の帯 */
  --drop-bg: rgba(15, 108, 189, .16);   /* drag-over ハイライト */
  --now-line: #D13438;                  /* 現在時刻インジケーター */
  /* neutral chips（無色Outlook予定・ステータス） */
  --neutral-fill: #F3F2F1;
  --neutral-edge: #C8C6C4;
  --neutral-text: #424242;
  --sidebar-width: 240px;
}

[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #1B1A19;
  --surface: #252423;
  --raised: #2D2C2B;
  --surface-hover: #323130;
  --edge: #3B3A39;
  --grid-line: #323130;
  --grid-line-faint: #2B2A29;
  --ink: #F3F2F1;
  --ink-muted: #C8C6C4;
  --ink-faint: #797775;
  --accent: #479EF5;
  --accent-fill: #3B82F6;
  --accent-soft: rgba(71, 158, 245, .15);
  --today-bg: rgba(71, 158, 245, .08);
  --weekend-bg: rgba(255, 255, 255, .04);
  --offhours-bg: rgba(0, 0, 0, .25);
  --drop-bg: rgba(71, 158, 245, .25);
  --now-line: #E37D80;
  --neutral-fill: #323130;
  --neutral-edge: #605E5C;
  --neutral-text: #D2D0CE;
}

/* @theme inline 必須: 値が var() 参照のため要素位置で解決させる。
   これで bg-surface / text-ink-muted / border-edge / ring-accent 等の
   ユーティリティが生成される */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-raised: var(--raised);
  --color-surface-hover: var(--surface-hover);
  --color-edge: var(--edge);
  --color-grid: var(--grid-line);
  --color-grid-faint: var(--grid-line-faint);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-ink-faint: var(--ink-faint);
  --color-accent: var(--accent);
  --color-accent-fill: var(--accent-fill);
  --color-accent-soft: var(--accent-soft);
  --color-today: var(--today-bg);
  --color-weekend: var(--weekend-bg);
  --color-offhours: var(--offhours-bg);
  --color-drop: var(--drop-bg);
  --color-now: var(--now-line);
  --color-neutral-fill: var(--neutral-fill);
  --color-neutral-edge: var(--neutral-edge);
  --color-neutral-text: var(--neutral-text);
}

body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* ===== イベントチップ（P1-4 で使用、--mc = member color） ===== */
.event-solid {
  background: var(--mc);
  color: var(--on-mc, #fff);
  border-left: 4px solid color-mix(in srgb, var(--mc) 65%, black);
  /* 隣接レーンとの境界ヘアライン（Outlook 風） */
  box-shadow: 0 0 0 1px var(--surface);
}
.event-tint { /* 仮（未送信）assignment 専用: 破線 + ハッチ込み */
  background: color-mix(in srgb, var(--mc) 18%, var(--surface));
  color: color-mix(in oklab, var(--mc) 75%, var(--ink));
  border-left: 3px dashed var(--mc);
  background-image: repeating-linear-gradient(135deg,
    transparent, transparent 4px,
    color-mix(in srgb, var(--mc) 12%, transparent) 4px,
    color-mix(in srgb, var(--mc) 12%, transparent) 8px);
}
[data-theme="dark"] .event-tint {
  background-color: color-mix(in srgb, var(--mc) 30%, var(--surface));
  color: color-mix(in oklab, var(--mc) 55%, white);
}
.event-neutral { /* 無色 Outlook 予定・ステータス */
  background: var(--neutral-fill);
  color: var(--neutral-text);
  border-left: 3px solid var(--neutral-edge);
}
/* 終日オーバーレイ帯（AllDayOverlay 用） */
.allday-band {
  background: color-mix(in srgb, var(--mc) 12%, transparent);
}
[data-theme="dark"] .allday-band {
  background: color-mix(in srgb, var(--mc) 18%, transparent);
}

/* テーマ追従スクロールバー */
* { scrollbar-color: var(--ink-faint) transparent; } /* Firefox */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--ink-faint); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-muted); }
```

**受け入れ基準**:
- `npm run build` がエラーなく通る（`@custom-variant` の位置に注意）
- DevTools で `document.documentElement.dataset.theme = 'dark'` を手動設定すると body 背景・スクロールバーが切り替わる
- `bg-surface` `text-ink-muted` `border-edge` `ring-accent` 等のクラスがJSXで使用可能

---

## P1-2. テーマ状態 + 切替UI + FOUCガード【S】

**ファイル**: `src/context/AppContext.jsx`, 新規 `src/components/shared/ThemeApplier.jsx`, `src/App.jsx`, `index.html`, `src/components/layout/Header.jsx`, `src/components/settings/SettingsView.jsx`

1. **AppContext.jsx**: `DEFAULT_SETTINGS`（80-84行目）に `theme: 'light'` を追加（`'light' | 'dark' | 'system'`）。reducer変更不要 — `UPDATE_SETTINGS` がマージし、352-361行目の既存effectが localStorage キー `construction-schedule-settings` へ永続化する。**settings は Firestore に同期されない（assignments のみ）= テーマは端末ごとの個人設定として正しい挙動**。将来 settings を Firestore 同期する場合は theme を除外すること（コメントで明記）。
2. **新規 `src/components/shared/ThemeApplier.jsx`**（null を返すコンポーネント、App.jsx の `<AppProvider>` 直下に配置）:
```jsx
import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';

export default function ThemeApplier() {
  const { settings } = useApp();
  const mode = settings.theme || 'light';
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (mode === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [mode]);
  return null;
}
```
3. **index.html**: `<script type="module">` の**前**にFOUCガードを挿入（MSAL+Firestore初期化で初回描画が遅く、ダーク選択ユーザーは毎回白フラッシュするため。LoginGate 表示中= AppProvider マウント前のテーマ適用もこれが担う）:
```html
<script>
  /* NOTE: storage key は AppContext.jsx の STORAGE_KEYS.settings と同期 */
  try {
    var s = JSON.parse(localStorage.getItem('construction-schedule-settings') || '{}');
    var dark = s.theme === 'dark' || (s.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {}
</script>
```
AppContext.jsx の STORAGE_KEYS 定義（35行目付近）に「キー名変更時は index.html の FOUC ガードも更新」のコメントを追加。
4. **Header.jsx**: 右側クラスタ（173行目 `ml-auto` div の先頭）に切替アイコンボタンを追加。クリックで light → dark → system 循環、`dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: next } })`（`useApp` を import）。アイコン: 太陽(light)/月(dark)/モニター(system)、`title="テーマ: ライト/ダーク/システム連動"`。スタイル: `p-1.5 rounded-lg text-ink-muted hover:bg-surface-hover`。
5. **SettingsView.jsx**: 「表示テーマ」セクションを追加 — 3つのラジオ（ライト / ダーク / システムに合わせる）を `settings.theme` にバインド。アイコンだけでは伝わらないメンバー向けの発見可能なUI。

**受け入れ基準**:
- Headerボタンで3モード循環、リロード後も保持される
- system モードで OS テーマ変更に追従する
- ダーク選択状態でリロードしても白フラッシュが出ない
- ログイン画面（LoginGate）にもテーマが適用される（FOUCガード経由）
- 他ユーザーの画面のテーマが変わらない（Firestore非同期の確認）

---

## P1-3. クラス移行 第1弾: シェル + カレンダー3ビュー + JobPanel【M】

**ファイル**: `src/components/layout/MainLayout.jsx`(1箇所), `Header.jsx`(21), `Sidebar.jsx`(4), `src/App.jsx`(4), `src/components/schedule/WeeklyView.jsx`(61), `DailyView.jsx`(25), `MonthlyView.jsx`(20), `src/components/jobs/JobPanel.jsx`(28)

※JobPanel は右に常時表示されるため第1弾に含める（案3では第2弾だったが、ダークで真っ白なパネルが常駐するのは許容外）。モーダル群・JobCard内の STAGE_COLORS は P2-4。

**変換表**（ファイルごとに検索置換 → hunk を目視確認）:

| 旧クラス | 新トークンクラス |
|---|---|
| `bg-gray-50`（ページ背景 MainLayout:12） | `bg-canvas` |
| `bg-white`（パネル・グリッドカード） | `bg-surface` |
| `bg-white`（sticky ヘッダー/時刻ガター: WeeklyView:647,651,704,784,906,910,957,1027; DailyView:343,346,367,437） | `bg-raised`（ダークでグリッド面より1段明るくしないとイベントが「すり抜けて」見える） |
| `hover:bg-gray-50` / `hover:bg-gray-100` | `hover:bg-surface-hover` |
| `bg-gray-100`（セグメントコントロールのトラック Header:138） | `bg-canvas` |
| `border-gray-200` / `border-gray-300` | `border-edge` |
| `border-gray-100`（時間罫線） | `border-grid` |
| `border-gray-50`（30分罫線） | `border-grid-faint` |
| `text-gray-700` / `text-gray-800` | `text-ink` |
| `text-gray-500` / `text-gray-600` | `text-ink-muted` |
| `text-gray-300` / `text-gray-400` | `text-ink-faint` |
| `bg-blue-50`（今日ヘッダー WeeklyView:663） | `bg-accent-soft` |
| `bg-blue-50/30`（今日列 WeeklyView:813,1066） | `bg-today` |
| `bg-gray-50/50`（週末列 WeeklyView:813,1066） | **削除**（P1-5の帯が代替） |
| `bg-blue-100/60` + `ring-blue-400`（dragOver WeeklyView:849,1089; DailyView:488） | `bg-drop` + `ring-accent` |
| `text-blue-600` / `text-blue-700` | `text-accent` |
| `bg-blue-600`（軸トグル active WeeklyView:526,536） | `bg-accent-fill`（text-white は維持） |
| `bg-red-500`（現在時刻ライン/ドット） | `bg-now` |
| `bg-white text-gray-800 shadow-sm`（ビュー切替 active pill Header:143,153,163） | `bg-surface text-ink shadow-sm dark:bg-surface-hover` |
| フィルターチップ非アクティブ `bg-white text-gray-400 border-gray-300` | `bg-surface text-ink-faint border-edge` |

**例外（触らない）**:
- インライン `backgroundColor: 'white'` のメンバーチップ内ドット（WeeklyView:629, DailyView:330, MonthlyView:305）— メンバー色上の白は両テーマで正しい
- `bg-white/30 text-white` の ✓ バッジ（WeeklyView:764, DailyView:419）— ソリッド色上に乗る
- `bg-emerald-600` / `bg-amber-400|300` の 仮/✓ バッジ — 意図的なセマンティック色（コメントで明記）
- Sidebar の `bg-orange-50 text-orange-700`（アクティブ項目）→ 維持 + `dark:bg-orange-500/15 dark:text-orange-300` を追加。`text-orange-600` アイコンも `dark:text-orange-400`
- JobPanel 内の TriStateChip 等の green/red 状態 → `dark:bg-green-500/20 dark:text-green-300`（red も同様）パターンを追加
- App.jsx のバナー（orange-500/gray-700/blue-500 ベタ塗り+白文字）→ 両テーマで成立するため維持

**受け入れ基準**:
- ライトの見た目が移行前と実質同一（微妙な色味の差は許容）
- ダークで: シェル・3ビュー・JobPanel に白い面が残らない / sticky ヘッダーがグリッドより1段明るい / dragOver ハイライトが見える
- `grep -nE '\\b(bg|text|border)-(white|gray)' src/components/layout src/components/schedule/WeeklyView.jsx src/components/schedule/DailyView.jsx src/components/schedule/MonthlyView.jsx src/components/jobs/JobPanel.jsx` の残存が上記例外のみ

---

## P1-4. Outlook風ソリッドイベントチップ【M / 最大の視認性改善】

**ファイル**: 新規 `src/utils/colorUtils.js`, `src/components/schedule/EventBlock.jsx`, `WeeklyView.jsx`, `DailyView.jsx`, `AllDayOverlay.jsx`

1. **新規 `src/utils/colorUtils.js`**:
```js
/** YIQ luminance: returns dark text for light colors (amber #F59E0B, lime #84CC16), white otherwise */
export function getContrastText(hex) {
  if (!hex) return '#FFFFFF';
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#1F1F1F' : '#FFFFFF';
}
```
（検証済み: #F59E0B→167≥150→黒文字、#14B8A6→133→白、#06B6D4→133→白。10メンバー色+納品色すべて両テーマで判読可能）

2. **EventBlock.jsx 44-63行目の色決定ロジックを削除**し、クラス選択に置換:
```js
// className 決定
let chipClass;
if (isStatus) chipClass = 'event-neutral';
else if (isAssignment) chipClass = isDraftOnly ? 'event-tint' : 'event-solid';
else chipClass = (colorOutlook && memberColor) ? 'event-solid' : 'event-neutral';
```
- ルート div に `chipClass` を追加し、`style` から `backgroundColor` / `backgroundImage` / `borderLeft` を**削除**（ハッチ・破線は `.event-tint` がCSSで担う）。`style` には `'--mc': memberColor || '#3B82F6', '--on-mc': getContrastText(memberColor)` を追加
- タイトル `<p>`（193-200行目）: `style={{ color: textColor }}` を削除（色はクラスから継承）、`font-medium` → `font-semibold`
- 時刻行（203行目）: `text-gray-400` を削除 → `opacity-75`（継承色の75%）
- 仮/✓バッジ（181-185行目）: 視認性確保のため `ring-1 ring-white/40` を追加
- isActive リング（146行目）: `ring-2 ring-blue-500` → `ring-2 ring-accent ring-offset-1 ring-offset-surface`
- hover: 既存 `hover:shadow-md` に `hover:brightness-105` を追加
- リサイズハンドルのピル（216行目）: `bg-gray-400/50` → `bg-current opacity-50`（コントラスト文字色を継承）
- ツールチップ（222-249行目）: `bg-white border-gray-200` → `bg-raised border-edge`、`text-gray-800/500/400` → `text-ink / text-ink-muted / text-ink-faint`、`bg-blue-50 text-blue-600` → `bg-accent-soft text-accent`

3. **終日チップを同ルールに統一**:
- WeeklyView 日付軸（726-771行目）: Outlook終日は `useOutlookColor ? 'event-solid' : 'event-neutral'` + `--mc`/`--on-mc`（現在の `color: 'white'` 固定をやめ getContrastText に）。assignment終日: synced は `event-solid`、draft は `event-tint`（現在のインラインハッチ式 757行目は削除）
- WeeklyView 人軸（977-1014行目）: 現在の `${member.color}20`/`${member.color}33` tint を上と同じルールに置換
- DailyView（382-426行目）: 同上

4. **AllDayOverlay.jsx**: 27行目 `backgroundColor: \`${it.color}1f\`` を削除し、className に `allday-band` を追加 + `style={{ '--mc': it.color, ... }}`（ダークで自動的に18%へ増量される）。draft のハッチ（30行目）は `${it.color}12` → `color-mix(in srgb, var(--mc) 10%, transparent)` 文字列に変更

**受け入れ基準**:
- 同期済み assignment / 色付きOutlook予定がメンバー色のベタ塗り+コントラスト文字（笹沼 #F59E0B は黒文字、他は白文字）
- 仮（未送信）は淡色+破線+ハッチで、ソリッドとの対比で一目で区別できる（両テーマ）
- 隣接レーン（layoutEvents の重なり）間に1pxヘアラインが見える
- ドラッグ移動・リサイズ・ダブルクリック編集・setDragImage ゴーストが従来どおり動く
- 「Outlook無色」トグルで Outlook 予定がニュートラルチップになる
- ✓/仮バッジ・ツールチップが両テーマで判読できる

---

## P1-5. 営業時間外シェーディング + 時刻ガター簡素化【S】

**ファイル**: `WeeklyView.jsx`, `DailyView.jsx`

1. 既存だが未使用の `settings.workingHours`（既定 08:00-18:00）を活用。コンポーネント先頭で1回計算:
```js
const workStartMin = timeStringToMinutes(settings.workingHours?.start || '08:00');
const workEndMin = timeStringToMinutes(settings.workingHours?.end || '18:00');
const offTopH = (workStartMin / 60) * HOUR_HEIGHT;
const offBottomTop = (workEndMin / 60) * HOUR_HEIGHT;
```
2. 各サブ列（日付軸: メンバーサブ列 div 835-839行目 / 人軸: 日サブ列 div 1062-1066行目 / DailyView: メンバー列 461-465行目）の**時間セルループの直前**に帯を描画（セルより先にレンダリング = 両者とも positioned なので DOM 順でセルの dragOver bg が帯の上に乗る。z-index 不要）:
```jsx
{isWeekend ? (
  <div className="absolute inset-0 bg-offhours pointer-events-none" />
) : (
  <>
    <div className="absolute inset-x-0 top-0 bg-offhours pointer-events-none" style={{ height: `${offTopH}px` }} />
    <div className="absolute inset-x-0 bottom-0 bg-offhours pointer-events-none" style={{ top: `${offBottomTop}px` }} />
  </>
)}
```
（DailyView は週末判定を `currentDate` から。日付軸の週末列 `bg-gray-50/50` は P1-3 で削除済み — この帯が全高で代替し、Outlook 同様「非稼働日は全時間帯シェード」になる）
3. **ガター簡素化**: `:30` サブラベル（WeeklyView 795-797 / 1038-1040、DailyView 447-449行目の span）を削除。時刻ラベルは `08:00` 形式のまま `text-[11px] text-ink-faint` 右寄せ。`w-14` は据え置き（sticky オフセットへの影響回避。`w-12` 化は任意）

**受け入れ基準**:
- 8:00-18:00 の稼働帯が白（surface）、0-8時/18-24時と週末列がシェードされ、視線が業務時間に誘導される
- シェード上でも dragOver ハイライト・スロットクリック・ダブルクリック・D&D ドロップが機能する
- StatusOverlay / AllDayOverlay / イベントの重なり順が崩れない（帯は最下層）
- ガターのラベルが各時 1 個になり、ノイズが減る

---

## P1-6. ビュー内の重複ナビ行を削除（Header一本化）【S / リスクほぼゼロの縦回収】

**ファイル**: `WeeklyView.jsx`, `DailyView.jsx`, `Header.jsx`

1. **WeeklyView 466-516行目**（今日/◀/▶ + weekLabel + スピナー行）と **DailyView 255-302行目**の同等ブロックを削除。Header（106-134行目）に同機能が既にある。`weekLabel` / `dayLabel` は P1-8 の1段ツールバー左端へ移設（`text-sm font-semibold text-ink`）
2. **Header.jsx**: `formatWeek` の「第n週」を実日付範囲に置換 — `getWeekDates` / `formatDateShort` を `utils/dateUtils` から import し、`useApp()` の `settings.showWeekends` で週末を除いた範囲 `6/8〜6/12` を表示。読込スピナーは `useCalendar()` の `loading`（既にimport済み）を読んで periodLabel 横に表示。モバイルは `hidden sm:inline` で短縮
3. コンテナ高さ `calc(100vh - 8rem)`（WeeklyView:464, DailyView:253）は**変更不要** — フィルター行はこの flex コンテナ内にあり、グリッドは `flex-1 min-h-0` なので行削除分は自動的にグリッドへ還元される

**受け入れ基準**: 週/日ナビが Header のみになり機能欠落がない。Header に実日付範囲とスピナーが出る。グリッド表示領域が縦に拡大する。

---

## P1-7. フィルター/軸モードを settings に統合（全ビュー共有・永続化）【S / P1-8 の前提】

**ファイル**: `src/context/AppContext.jsx`, `WeeklyView.jsx`, `DailyView.jsx`, `MonthlyView.jsx`

1. `DEFAULT_SETTINGS` に追加: `hiddenMemberIds: []`, `hiddenCategoryIds: []`, `viewAxis: 'date'`。**「非表示リスト」方式**（members.js に新メンバーを追加しても既定で表示されるため）。表示判定は `!hidden.includes(id)`。カテゴリには `'__none__'`（未分類）も含む
2. `loadInitialState` にワンタイムマイグレーション: 旧キー `construction-schedule-view-axis` → `viewAxis`、`construction-schedule-visible-categories`（表示リスト）→ `hiddenCategoryIds = [...WORK_CATEGORY_IDS, '__none__'].filter(id => !visible.includes(id))` に変換し、旧キーを `removeItem`
3. 3ビューに重複実装された揮発 state を削除:
   - WeeklyView: `axisMode` useState + localStorage（66-81行目）、`visibleMembers`（84-86行目）、`visibleCategories` + localStorage（89-128行目）
   - DailyView: `visibleMembers`（39行目）
   - MonthlyView: `visibleMembers`（98行目）
   - 置換: `const visibleOrderedMembers = orderedMembers.filter(m => !(settings.hiddenMemberIds ?? []).includes(m.id))`、トグルは `dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenMemberIds: next } })`。全選択/全解除は `[]` / `[...MEMBER_ORDER]`
4. settings は localStorage のみ永続（Firestore非共有）= フィルターも端末ごとの個人設定で正しい

**受け入れ基準**:
- 週間で絞ったメンバーが日別/月間に切り替えても維持され、リロード後も復元される
- 軸モード（日付軸/人軸）がリロード後も維持される
- 旧 localStorage キーが消え、旧設定が1回だけ引き継がれる
- members.js に仮メンバーを追加すると既定で表示される

---

## P1-8. ツールバー3段→1段化（FilterPopover）【M / 縦80〜100px回収】

**ファイル**: 新規 `src/components/shared/FilterPopover.jsx`, `WeeklyView.jsx`, `DailyView.jsx`

1. **新規 FilterPopover.jsx**（共有コンポーネント）:
   - props: `{ label, badge, items: [{id, label, color, checked}], onToggle(id), onToggleAll, allChecked }`
   - トリガーボタン: `text-xs px-2.5 py-1 rounded-lg border border-edge bg-surface text-ink-muted hover:bg-surface-hover` + 選択数バッジ（例 `6/9`）。メンバー用は選択中の色ドットを最大5個重ねて表示
   - パネル: `absolute mt-1 z-40 w-56 bg-raised border border-edge rounded-lg shadow-lg p-2`。先頭に 全選択/全解除 行、以下チェックボックス行（`accent-color: var(--accent)` の checkbox + 色ドット + ラベル）。**クリックで閉じない**（複数トグルできるのがドロップダウンでなくポップオーバーである理由）
   - 閉じる: document への mousedown リスナー（パネル外）+ Escape + `dragstart`。開閉 state は内部 useState
   - 配置: ツールバー行（グリッドの overflow-auto の**外**）に置くためクリップされない。z-40 は sticky ヘッダー(z-20/30) より上
2. **WeeklyView 519-636行目の3行を削除**し、1行（高さ~40px, `flex items-center gap-2 mb-2`）に統合:
   `[weekLabel] [日付軸|人軸 セグメント（bg-canvas rounded-md p-0.5、active: bg-surface shadow-sm text-ink — ベタ塗り bg-accent-fill から Outlook 風ピルへ変更）] [FilterPopover 作業種別 (WORK_CATEGORIES + 未分類)] [FilterPopover メンバー (orderedMembers ※納品含む11件)] [表示 ▾ ポップオーバー: 「Outlook予定を色付き表示」トグル + 「週末を表示」トグル(settings.showWeekends)]`
   フィルター実体は P1-7 の settings を読み書き
3. **DailyView 305-336行目**のメンバーチップ行も同コンポーネントで置換（1行: dayLabel + メンバーポップオーバー）。MonthlyView のチップ行も同様に置換可能（同一 settings を読むため整合は自動）

**受け入れ基準**:
- ツールバーが1行になり、グリッドの可視時間帯が拡大する
- ポップオーバー開状態で複数チェックをトグルでき、外側クリック/Escで閉じる
- バッジ表示でフィルター適用中であることが常時わかる（チップ常時表示の代償補償）
- ドラッグ開始でポップオーバーが閉じ、D&D を妨げない
- 3ビュー間でフィルターが共有されている（P1-7）

---

## P1-9. 人軸50列問題: 最小幅固定 + 横スクロール【S〜M】

**ファイル**: `WeeklyView.jsx`, `DailyView.jsx`

グリッドコンテナ（640行目 `overflow-auto`、時刻ガター `sticky left-0`、ヘッダー `sticky top-0`）は既に2次元スクロール可能。問題は flex 圧縮のみ。

1. 定数: `const PERSON_SUBCOL_MIN_W = 88; const DAY_SUBCOL_MIN_W = 76;`
2. **人軸**: メンバー列の `min-w-[100px]`（ヘッダー916行目 / 終日964行目 / ボディ1049行目の3層**すべて**）を `style={{ minWidth: \`${displayDates.length * PERSON_SUBCOL_MIN_W}px\` }}` に置換（5日×88px=440px/人、11人で~4.8m幅 → 横スクロール）。**3層の幅は必ず同一定数から導出**（1箇所でもズレると列ズレ）
3. **日付軸**: 日列の `min-w-[120px]`（661 / 711 / 811行目）を `style={{ minWidth: \`${Math.max(visibleOrderedMembers.length * DAY_SUBCOL_MIN_W, 120)}px\` }}` に置換
4. 各行ラッパーの `.flex`（649, 702, 782, 908, 955, 1025行目）に `w-max min-w-full` を追加し親の overflow-auto で横スクロールさせる
5. **DailyView**: メンバー列 `min-w-[80px]`（350, 377, 463行目）→ `min-w-[140px]`、行ラッパーに同じく `w-max min-w-full`
6. **（任意）ソロ表示**: 人軸メンバー名ヘッダー（920-925行目）/ 日付軸メンバーサブヘッダー（682-691行目）に onClick — 複数表示中なら現在の hiddenMemberIds を useRef に退避して当該メンバー以外を hidden に、既にソロなら退避分を復元。`title="クリックでこのメンバーのみ表示/解除"`。「この人の週を見る」を9クリック→1クリック化

**受け入れ基準**:
- 人軸・全員表示時に各日サブ列が88px以上確保され、チップのタイトルが読める
- 横スクロール時、ヘッダー行・終日行・ボディの列が完全に揃ったまま（週末表示オン/オフ、メンバー絞り込み状態でも）
- 時刻ガターが横スクロールに追従して左に固定表示（bg-raised で下が透けない）
- 横スクロール状態での D&D ドロップ・画面端付近のドラッグ自動スクロール（Chrome/Edge ネイティブ）が機能する

---

# PHASE-2（後で。PHASE-1 安定後に順次）

## P2-1. Outlook風ヘッダー: today pill / メンバーはアンダーラインタブ【M】
**ファイル**: `WeeklyView.jsx`, `DailyView.jsx`
- 日付軸ヘッダー: 曜日を小さく上に（`text-[11px] text-ink-faint`）、日付数字を下に。今日は `w-7 h-7 rounded-full bg-accent-fill text-white font-semibold` の塗りつぶしピル + 日列下端に2px `bg-accent-fill` ボーダー（現在のセル全面 `bg-accent-soft` 塗りを置換）
- メンバーサブヘッダー（685-690 / 920-925行目、DailyView 354-359行目）: ベタ塗り色バー → 透明bg + `text-ink-muted text-[10px]` + `border-b-[3px]`（メンバー色）+ 色ドット。P1-4 でチップがソリッドになった後はヘッダーまで彩度全開だと壁一面の色になるため。色弱対応はドット+下線+チップ色の三重符号化で担保
- 人軸の日サブヘッダー: 今日=ミニアクセントピル、週末=`text-ink-faint`、他=`text-ink-muted`（gray-100チップ廃止）
- **必ず P1-9 の後に実施**（狭い列幅では3px下線の名前帰属が困難）

## P2-2. 現在時刻インジケーター強化【S】
**ファイル**: `WeeklyView.jsx`, `DailyView.jsx`
- 線を `h-px` → `h-[2px] bg-now`、左端ドットを8pxに。今日列のみの現仕様は維持（日付軸で他の日に線を引くのは誤情報）
- 既存 `updateCurrentTime` effect を拡張して `HH:MM` 文字列も state 保持し、sticky 時刻ガター内に絶対配置チップを描画: `<span class="absolute right-1 -translate-y-1/2 text-[10px] font-semibold text-white bg-now rounded px-1 z-20">14:23</span>`（今日が表示週に含まれる時のみ。ガターは軸モードごとに2箇所あるので両方）。z-20 < sticky ヘッダー z-30 を維持

## P2-3. ステータス/バッジのセマンティックトークン化【S】
**ファイル**: `src/components/schedule/StatusOverlay.jsx`, `src/data/statusTypes.js`
- StatusOverlay のラベルバッジ（36-45行目、pastel `status.bgColor + 'CC'` はダークで光る）→ `background: color-mix(in srgb, var(--status-c) 14%, var(--raised))`, `color: color-mix(in oklab, var(--status-c) 70%, var(--ink))`, `'--status-c': status.color` を渡す。15-alpha の列ウォッシュとハッチは低アルファで両テーマ可 → 維持
- statusTypes.js の `bgColor` フィールドは不要化 → 削除 or `@deprecated` コメント（将来 pastel-on-dark バグの再発防止）
- 不可（#9CA3AF）/休み（#6B7280）はダークで沈むため、`[data-theme=dark]` 時に1段明るい値を返すか color-mix で white 30% 混ぜる調整を実機確認

## P2-4. クラス移行 第2弾: モーダル群 + 残りファイル【M】
**ファイル**: `EventDetailModal.jsx`(46), `SettingsView.jsx`(32), `AssignModal.jsx`(30), `QuickAddModal.jsx`(19), `JobCard.jsx`(11+色マップ), `LoginGate.jsx`(10), `src/components/shared/Toast.jsx`
- P1-3 と同じ変換表を適用。追加: モーダル backdrop `bg-black/30` → `bg-black/40 dark:bg-black/60`、モーダルパネル `bg-white` → `bg-raised`、フォーム入力 `bg-surface border-edge text-ink placeholder:text-ink-faint`（ネイティブ date/time picker は P1-1 の color-scheme で対応済み）
- JobCard の `STAGE_COLORS` / `MAINT_STATUS_COLORS`（Tailwindクラス文字列マップ）: 値のみ `bg-{c}-100 text-{c}-800 dark:bg-{c}-500/20 dark:text-{c}-300` パターンへ。**キー（SFステージ文字列）は触らない**
- 各モーダル移行後に 割当→編集→Outlook反映 フローを1周走らせる（クラスのみの変更でロジック非接触を確認）
- 完了後にテーマ既定値を `'light'` のまま運用するか `'system'` に変えるか上司に確認

## P2-5. リグレッションガード: トークン専用 lint【S】
**ファイル**: 新規 `scripts/check-theme-tokens.mjs`, `package.json`, `.github/workflows/deploy.yml`
- `src/**/*.jsx` を走査し `\b(bg|text|border|ring|divide)-(white|gray|slate)-?\d*\b` とインライン hex+alpha 連結 `\$\{...[Cc]olor\}[0-9a-fA-F]{2}\b` を検出して exit 1。`/* theme-exempt */` コメントで許可リスト（白ドット、bg-white/30 バッジ等）。deploy.yml の build 前ステップに追加。red/amber/emerald/blue 等のセマンティック色は禁止リストに**入れない**
- P2-4 完了の done 判定としても使う（許可リスト外 0 件）

## P2-6. （任意）Sidebar「メンバー」チェックリスト【M】
**ファイル**: `Sidebar.jsx`
- Outlook の「My Calendars」風: ナビ下に メンバー セクション（checkbox `accent-color: var(--accent)` + 色スウォッチ + nameJa + 全選択/全解除）。P1-7 の `settings.hiddenMemberIds` を読み書きするだけなので FilterPopover と自動で整合。collapsed 時は非表示。**納品** 疑似メンバーも必ずリストに含める
- P1-8 のポップオーバーで操作要件は満たすため、Outlook 見た目の仕上げとしての任意項目

## P2-7. （任意・テーマ外の操作効率改善）仮予定の一括Outlook送信【M】
**ファイル**: `WeeklyView.jsx`, 新規 `src/hooks/useOutlookPush.js`, `AssignModal.jsx`, `src/services/graphCalendarService.js`
- ツールバー右端に「仮 n件」ボタン（n = 表示週の `!outlookEventId && !isDelivery && !skipOutlookSyncメンバー` 件数）。ポップオーバーでドラフト一覧 + 各行送信 + 一括送信
- **実装前に AssignModal の「Outlookに登録」コードパスを精読し、再実装ではなく必ず既存ルーチンの抽出共有にすること**（タイムゾーン/本文/Calendars.ReadWrite.Shared の挙動差異防止）。成功時は既存の `UPDATE_ASSIGNMENT({outlookEventId})` パス。直列+200ms間隔（Graphスロットリング）、失敗分はドラフトのまま（冪等）、結果は Toast。未ログイン時は disabled

---

# 全体検証チェックリスト（各PHASE完了時に両テーマ × 日付軸/人軸で実施）

1. JobPanel からの D&D 割当（ドラッグ中 EventBlock の pointer-events 無効化が生きているか）
2. 案件クリック選択 → スロットクリック配置（オレンジバナー）
3. スロットダブルクリック → QuickAddModal
4. イベントのドラッグ移動 / 下端リサイズ（30分スナップ）
5. Ctrl+C / Ctrl+V コピペ、Delete でのグループ削除
6. 仮/✓ バッジと title ツールチップ、Outlook登録 → ✓ への遷移
7. 作業種別フィルター（未分類含む）/ メンバーフィルター / 軸トグル — リロード・ビュー切替をまたいで保持
8. 終日行チップ + AllDayOverlay 帯 + StatusOverlay（不可/休み/移動）の重なり順
9. 横スクロール時のヘッダー/終日/ボディの列整列、sticky ガターの背景
10. テーマ切替 3モード循環、リロード時の FOUC なし、他端末のテーマに影響なし
11. `npm run build` 成功（GitHub Pages デプロイ前提）

# 実装順サマリ

| # | 項目 | 工数 | 依存 |
|---|------|------|------|
| P1-1 | トークン基盤 (index.css) | S | — |
| P1-2 | テーマ状態+切替UI+FOUCガード | S | P1-1 |
| P1-3 | クラス移行 第1弾（シェル+3ビュー+JobPanel） | M | P1-1 |
| P1-4 | ソリッドイベントチップ | M | P1-1 |
| P1-5 | 営業時間外シェーディング+ガター簡素化 | S | P1-1 |
| P1-6 | 重複ナビ削除 | S | — |
| P1-7 | フィルターのsettings統合 | S | — |
| P1-8 | ツールバー1段化+FilterPopover | M | P1-6, P1-7 |
| P1-9 | 人軸 最小幅+横スクロール | S-M | — |
| P2-1〜P2-7 | ヘッダーrestyle / 時刻チップ / ステータストークン / モーダル移行 / lint / Sidebarリスト / 一括送信 | — | PHASE-1 |

P1-3 以降に書く**新規コードは最初からトークンクラスで書く**こと（二度触り防止）。コミットは項目単位の Conventional Commit（例: `feat: add theme token foundation and light/dark switch`）。