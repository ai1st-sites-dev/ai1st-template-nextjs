// ══════════════════════════════════════════════════════════════════════════════════════════════════
// team —— 块头（intro）+ 一组成员（members，可带一张招聘卡 join），Webpixels / Bootstrap 那一套（#1487，总纲 #1422 的 T2.9）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，两层旋钮**：intro*（introPosition / introAlign）· members*（membersColumns / memberPhoto /
//    photoShape / memberStyle / memberAlign），五个预设各是一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，
//    `data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。
//    旋钮值写在根元素上（`data-intro-position` … `data-member-align` / `data-tone`），`block.css` 按它们排；形态目录
//    自己不带几何。旋钮彼此独立：`memberPhoto=left` 时 `memberAlign` 不起作用，但 markup 一个字不变（只有根上那个
//    `data-member-align` 跟着变），不起作用这件事住在 `block.css` 的选择器里。
//
// 🔴 **藏东西一律是不渲染**（部件有数据才画），不靠 CSS 藏：成员没写 `photo`（或没有 `imageUrl`）⟹ 没有 `<img>`；
//    没写 `bio` / `links` ⟹ 没有那一行；`join` 空 ⟹ 没有招聘卡。块头只看 `headline` / `body`：两个都空 ⟹ 块头那一列
//    整个不渲染。
//
// 🔴 **照片的键叫 `imageUrl`**（`members[].photo.imageUrl`）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`）。建站填图那一侧**不**给它生成图（`block-manifest.js` §imageSlotsOf 把 `members`
//    跟 `avatars` 放在一起排除 —— 生成的人脸冒充的是这家店的员工）。
//
// 🔴 **图标是内联 SVG**（同 features / milestones）：`iconTable` 由服务端按数据里出现的名字查好传进来
//    （`scripts/lib/icons.js` §iconTableFor —— 它只收键名正好是 `icon` 的值，所以 `links[]` 的字段叫 `icon`）。
//    一条 link 的图标查不到 ⟹ 那一条不画（一个空的 `<a>` 是看不见的链接）。招聘卡的 `person-plus` 写死在这里，
//    登记在 `BLOCK_ICONS['team']`。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg），纯色、brand、渐变都认；
//    这里不自己算亮度、不自己拼渐变。

import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface TeamImage { imageUrl?: string; alt?: string }
export interface TeamLink { icon?: string; href?: string }
export interface TeamMember { name?: string; role?: string; photo?: TeamImage; bio?: string; links?: TeamLink[] }
export interface TeamButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean }
export interface TeamJoin { title?: string; body?: string; cta?: TeamButton }
export interface TeamOptions {
  introPosition?: string; introAlign?: string;
  membersColumns?: string; memberPhoto?: string; photoShape?: string; memberStyle?: string; memberAlign?: string;
}
export interface TeamData {
  options?: TeamOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  members?: TeamMember[];
  join?: TeamJoin;
  bg?: BgValue;
}

interface Props {
  data: TeamData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// members 1–12 条（`slots.members.maxItems`，validateSite 拦超出的）。
const MAX_MEMBERS = manifest.slots.members.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const imgOf = (v: unknown): TeamImage | null => (isObj(v) && str((v as TeamImage).imageUrl) ? (v as TeamImage) : null);

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'tm-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'tm-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'tm-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'tm-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

function btnClass(b: TeamButton, fallback: BtnStyle): string {
  const style = b.style || fallback;
  if (style === 'link') return 'btn btn-link btn-sm px-0 d-inline-flex align-items-center text-nowrap';
  if (style === 'solid') return 'btn btn-primary btn-sm d-inline-flex align-items-center justify-content-center text-nowrap';
  return 'btn btn-outline-primary btn-sm d-inline-flex align-items-center justify-content-center text-nowrap';
}

export default function TeamNewSection({ data, block, iconTable = {} }: Props) {
  const d: TeamData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: TeamOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof TeamOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;
  const hasIcon = (name: unknown) => typeof name === 'string' && !!iconTable[name];

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 features / milestones：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : eyebrow.style in EYEBROW_CLASS ? eyebrow.style : 'none';
  const hasIntro = !!(str(d.headline) || str(d.body));
  const members = (Array.isArray(d.members) ? d.members : []).filter((m): m is TeamMember => isObj(m)).slice(0, MAX_MEMBERS);
  const join = isObj(d.join) && (str(d.join.title) || str(d.join.body)) ? d.join : null;
  const joinCta = join && isObj(join.cta) && str(join.cta.label) ? join.cta : null;

  return (
    <section
      {...blockAttrs('team', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-members-columns={k.membersColumns}
      data-member-photo={k.memberPhoto}
      data-photo-shape={k.photoShape}
      data-member-style={k.memberStyle}
      data-member-align={k.memberAlign}
      data-tone={tone}
      data-bs-theme={bsThemeForBg(d.bg)}
      className="position-relative py-16 py-lg-24"
      style={bgValue ? { background: bgValue } : undefined}
    >
      <div className="container">
        <div className="row tm-frame gy-10 gx-lg-16">
          {hasIntro ? (
            <div className="col-12 tm-introcol" data-part="intro">
              <div className="tm-intro-text" data-part="intro-text">
                {eyebrow && eyebrowStyle !== 'none' ? (
                  <div className="mb-4" data-part="eyebrow">
                    <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="introEyebrow.text">
                      {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                    </span>
                  </div>
                ) : null}
                {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 tm-title" data-slot="headline">{d.headline}</h2> : null}
                {d.body ? <p className="fs-5 text-muted mb-0" data-slot="body">{d.body}</p> : null}
              </div>
            </div>
          ) : null}
          <div className="col-12 tm-memberscol" data-part="members">
            <div className="tm-grid">
              {members.map((m, i) => {
                const photo = imgOf(m.photo);
                const links = (Array.isArray(m.links) ? m.links : []).filter((l): l is TeamLink => isObj(l) && hasIcon(l.icon) && !!str(l.href));
                return (
                  <div key={i} className="tm-member" data-part="member">
                    <div className="tm-inner h-100">
                      {photo ? (
                        <div className="tm-photo" data-part="photo">
                          <img src={photo.imageUrl} alt={photo.alt || m.name || ''} />
                        </div>
                      ) : null}
                      <div className="tm-text">
                        {m.name ? <div className="tm-name fw-semibold fs-5" data-slot={`members.${i}.name`}>{m.name}</div> : null}
                        {m.role ? <div className="tm-role text-sm text-muted" data-slot={`members.${i}.role`}>{m.role}</div> : null}
                        {m.bio ? <p className="tm-bio text-sm text-muted mb-0" data-part="bio" data-slot={`members.${i}.bio`}>{m.bio}</p> : null}
                        {links.length ? (
                          <div className="tm-links d-flex gap-3" data-part="links">
                            {/* 🔴 #1508 那条规则：站内路径（`/…`）走 `next/link`（展示站跑在 basePath 下，裸 `<a>` 不吃前缀、根路径闸拒绝切换）；
                                `mailto:` / `tel:` / `http(s):` 保持裸 `<a>`。 */}
                            {links.map((l, j) => (String(l.href).startsWith('/')
                              ? <Link key={j} className="tm-link text-muted" href={String(l.href)} aria-label={l.icon} data-part="link">{icon(l.icon)}</Link>
                              : <a key={j} className="tm-link text-muted" href={l.href} aria-label={l.icon} data-part="link">{icon(l.icon)}</a>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              {join ? (
                <div className="tm-member" data-part="join">
                  <div className="tm-join h-100 d-flex flex-column justify-content-center">
                    <div className="tm-join-icon d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary mb-4">
                      {icon('person-plus')}
                    </div>
                    {join.title ? <div className="tm-join-title fw-semibold fs-5 mb-1" data-slot="join.title">{join.title}</div> : null}
                    {join.body ? <p className="text-sm text-muted mb-4" data-slot="join.body">{join.body}</p> : null}
                    {joinCta ? (
                      <Link href={joinCta.href || '#'} className={`${btnClass(joinCta, 'outline')} align-self-start tm-join-cta`} data-cta={joinCta.style || 'outline'}>
                        {joinCta.icon ? icon(joinCta.icon, 'me-2') : null}
                        <span>{joinCta.label}</span>
                        {joinCta.arrow ? <span className="ms-2 d-inline-flex">{icon('arrow-right')}</span> : null}
                      </Link>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
