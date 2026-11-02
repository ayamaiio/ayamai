/** Product-specific informational drafts, not a representation of legal compliance. */
export const LEGAL_UPDATED = "October 31, 2026";

export type LegalDocument = {
  title: string;
  intro: string;
  sections: { id: string; title: string; paragraphs: string[] }[];
};

export const legalDocuments: Record<"privacy" | "terms", LegalDocument> = {
  privacy: {
    title: "Privacy Policy",
    intro: "This policy explains how ayamai processes account details, media, viewing activity and technical information, what others can see, and how to contact us about your data.",
    sections: [
      {
        id: "operator",
        title: "1. Who operates ayamai",
        paragraphs: [
          "Mark Foster operates ayamai at ayamai.io. For privacy questions and requests, contact privacy@ayamai.io. Requests for access to the community go to contact@ayamai.io, which is not a privacy-request channel. Delaware is the operator’s chosen governing jurisdiction, subject to privacy and consumer rights that cannot be waived in your location.",
          "This policy covers the ayamai web app and its selected-media browser-capture integration. It does not replace the policies of websites you visit or services you connect. The service is for adults aged 18 or older, or the higher legal age required where they live.",
        ],
      },
      {
        id: "information",
        title: "2. Information the service processes",
        paragraphs: [
          "Account and profile information: authentication identifiers and session information, account settings, the time of adult confirmation, and optional public handle, display name and biography. Clerk handles sign-in information such as email and any identity-provider information you supply; ayamai links application records to your authenticated account.",
          "Media and contributions: uploaded or imported images, GIFs and videos, previews, filenames, size, media type, duration, captions, hashtags, gallery order, visibility and attribution choices. We also store comments, saves, likes and dislikes, follows, reviews and ratings, blocks and reports, and relevant timestamps.",
          "Invitations: ayamai is invite-only. The owner records each invitation, its status, the invited email, and the account and time of acceptance. This creates an internal record of who joined through an invitation. Members who joined before invitations were introduced remain without an inviter record. If you request access at contact@ayamai.io, we process your email and message to respond.",
          "Private labeling: structured labels, normalized tags, notes, annotation history, provenance and source URLs you provide, and dataset/export records. These annotations are separate from a post’s public caption and hashtags.",
          "Viewing and recommendation information: account-linked watch and dwell time, completions, replays, quick skips, reactions, feed-session ordering and filters, and qualifying daily video-view records. Viewing behavior can reveal sensitive sexual interests even without your real name.",
          "Imports and capture: source links, provider/file identifiers, import status and errors, and encrypted connection credentials when you authorize a supported cloud account. The capture integration receives selected media and pairing/authorization information, not permission to collect your entire browsing history.",
          "Technical information: requests, route paths, response codes, errors and rate-limit events. Hosting and authentication providers may process IP addresses, browser/device details, timestamps and requested URLs. Ayamai application request logs remove query strings. The current frontend source does not load an analytics tracker. If a deployment enables one, its pageview collection must be reviewed and disclosed separately.",
        ],
      },
      {
        id: "purposes",
        title: "3. Why we use it",
        paragraphs: [
          "We use data to authenticate accounts; store, deliver and organize media; apply access and visibility rules; enable social features, labels and exports; personalize recommendations; prevent abuse; troubleshoot problems; and respond to safety, rights and legal requests.",
          "Recommendations use explicit choices such as likes and saves and, when enabled, viewing behavior. Collaborative recommendation participation is a separate account setting and is off by default. Private annotations are not public tags, and private viewing must not become public viewing history merely because a post is later published.",
          "Where applicable, processing may rely on providing the service you request, consent, legitimate interests in security and operation, or legal obligations. Sensitive-interest processing can require explicit consent or additional safeguards under local law. Publishing this template does not establish that those requirements, consent mechanisms or jurisdiction-specific obligations have been satisfied.",
        ],
      },
      {
        id: "audiences",
        title: "4. What other people can see",
        paragraphs: [
          "A public/shared post can be discovered by other eligible viewers according to the app’s access rules; it is not confidential. New-post screens favor sharing, so review the audience before posting. Existing private media is not permission to publish it. A private item is restricted by application access controls rather than included in the shared feed.",
          "Anonymous attribution hides the uploader’s profile from other viewers; it does not make the account unidentifiable to the operator, authentication provider or infrastructure providers. Optional profile attribution, comments and other social features may reveal the identity you choose to present. Other viewers can copy or capture shared material, which we cannot reliably recall.",
          "Personal labels and notes are visible only to the person labeling. Review visibility is distinct: the reviewer and poster can access a review; other readers need both access to the video and a follow relationship with its poster. Following someone never unlocks private media. Video-view totals do not display viewer identities.",
          "Invitation relationships do not appear on public profiles or to ordinary members. The owner can review owner-issued invitation status and membership records to administer access and investigate abuse; the app does not expose a member activity history to the inviter.",
          "Authorized operator/moderator access may be needed for support, security, reports and lawful requests. We may disclose information when legally required or reasonably necessary to address abuse, protect people or enforce the Terms. We do not promise secrecy against lawful process.",
        ],
      },
      {
        id: "providers",
        title: "5. Service providers and connected services",
        paragraphs: [
          "The configured AWS deployment uses Lightsail for application hosting and managed PostgreSQL for account-linked records. AWS may process application requests and stored records. The active production host and database region were not independently verified during this documentation update. See https://aws.amazon.com/privacy/.",
          "Clerk provides authentication and session management and processes sign-in details and authentication/device information. See https://clerk.com/legal/privacy.",
          "Cloudflare R2 stores original media and preview files in a private bucket and may process related storage and delivery requests. Private storage is not end-to-end encryption or a guarantee against every unauthorized access. See https://www.cloudflare.com/privacypolicy/.",
          "Google Drive, Dropbox and MEGA are contacted when you use their supported imports or connections. Availability depends on configuration; an unconfigured connector is not an active integration. Provider links, file requests and authorization data are processed as needed for the import you request. Their policies apply separately: https://policies.google.com/privacy, https://www.dropbox.com/privacy and https://mega.io/privacy.",
          "The frontend includes an Umami-compatible adapter for limited aggregate events. The checked app HTML does not load a tracker. If a deployment enables one, approved events contain batch counts or action types and surfaces; the adapter excludes media IDs, URLs, comment text, private labels and sexual-interest tags. Review any tracker-added pageviews before enabling it. See https://umami.is/privacy.",
          "Providers may process information outside your country, including in the United States. We do not promise a particular storage region, transfer mechanism or country-specific certification through this template. No advertising, personal-data-sale or session-replay feature is implemented by the app’s custom analytics code.",
        ],
      },
      {
        id: "controls",
        title: "6. Your available controls",
        paragraphs: [
          "Viewing-activity collection is enabled by default in the current implementation. In Account, “Use my viewing activity” controls new behavioral recommendation telemetry. Turning it off does not remove existing records or disable explicit likes, dislikes and saves. “Help other adults’ recommendations” controls collaborative participation separately.",
          "“Clear viewing history” removes your raw watch events and resets watch-time, completion, replay and skip summaries. It keeps reactions and saves. It does not currently delete the separate daily video-view records, private annotations, comments or provider logs; it is not a full account erasure tool.",
          "You can manage your profile, remove your own media using available deletion controls, adjust post visibility, manage labels and create private label exports. Supported cloud-account connections can be disconnected; disconnecting does not delete files already imported. Revoke a provider’s authorization there too if appropriate.",
          "For access, correction, a copy, deletion, restriction, objection, withdrawal of consent or other applicable privacy rights, email privacy@ayamai.io. Describe the request without emailing sensitive media or passwords. We may need proportionate account verification and will handle requests under applicable law, including any required response deadlines. You may also complain to your relevant privacy regulator. Full self-service account erasure and an export of every account record are not currently provided.",
        ],
      },
      {
        id: "retention",
        title: "7. Retention and deletion limits",
        paragraphs: [
          "Uploaded media and account-linked records are retained to operate the service until removed through applicable controls or a verified request, subject to legal, safety and operational needs. No blanket automatic retention deadline is currently implemented for profiles, annotations, comments, cumulative recommendation signals or daily video-view records.",
          "Raw playback events older than 90 days are eligible for cleanup when that account records further accepted playback activity. This is request-driven cleanup, not a scheduled service-wide guarantee that every event disappears on day 90. Aggregated recommendation and daily-view records are separate and do not expire under that cleanup.",
          "Private label-dataset snapshots expire for access after seven days. Expired database records are cleaned up in bounded batches during dataset requests; a background purge is not guaranteed. A downloaded copy remains on the device where you save it. Exported media access remains subject to current permissions and deletion.",
          "Removing a file is intended to remove its active application record and associated stored objects through deletion controls. Errors, backups, infrastructure logs, legal preservation and copies made by other people can require different handling. We do not promise instantaneous erasure from every system or removal of copies outside our control. Contact us if deletion fails.",
        ],
      },
      {
        id: "browser-storage",
        title: "8. Cookies and browser storage",
        paragraphs: [
          "Authentication uses session technologies, including cookies managed by Clerk. Browser storage also keeps preferences, collection position, playback progress and similar local state. Shared-device users should sign out and consider clearing site data; clearing browser storage does not erase server records.",
          "The viewing-activity setting is not an all-provider analytics or cookie-consent switch. This policy does not itself implement consent for non-essential cookies or sensitive-data processing. Required consent controls and regional restrictions need to be assessed separately before offering the service in affected jurisdictions.",
        ],
      },
      {
        id: "ai",
        title: "9. AI training and generation are not current features",
        paragraphs: [
          "The current product uses labeling and behavioral signals for recommendations. AI adult-image/video generation and training a generative model on members’ uploads are not currently offered.",
          "These policies do not grant permission to use your uploads, private annotations or viewing history to train a generative model. Any such future program would require a separate product decision, clear updated disclosures, an explicit opt-in and any other legally required permissions, rights and safeguards. Choosing public visibility or collaborative recommendations is not that opt-in.",
        ],
      },
      {
        id: "security",
        title: "10. Security and adult-only access",
        paragraphs: [
          "The app uses authenticated access, authorization checks and private object storage to reduce unauthorized access. No system is perfectly secure, and the service is not an encrypted vault. Do not upload material whose disclosure would create an unacceptable risk, and use strong account security.",
          "People under 18, or below a higher locally required age, must not use the service. An adult-confirmation screen is not a claim that identity or age has been independently verified. Contact privacy@ayamai.io if you believe a minor’s information or prohibited material is present so we can investigate and take appropriate action.",
        ],
      },
      {
        id: "changes",
        title: "11. Policy changes and contact",
        paragraphs: [
          "We will update the date on this page when the policy changes. Material changes should be communicated through the service or available account contact channels before new processing begins; where law requires consent or advance notice, those requirements apply. A policy edit alone does not authorize a new use of sensitive data.",
          "Privacy requests and questions: privacy@ayamai.io. Operator: Mark Foster. Please obtain qualified legal advice on the service’s actual privacy, adult-content, consent, age-assurance and international obligations before relying on this template for launch.",
        ],
      },
    ],
  },
  terms: {
    title: "Terms of Service",
    intro: "These terms describe the conditions for using ayamai, an invite-only community operated by Mark Foster. Read them with the Privacy Policy. Contact privacy@ayamai.io with legal, privacy or content concerns, and contact@ayamai.io to request access.",
    sections: [
      {
        id: "eligibility",
        title: "1. Adults only; lawful access",
        paragraphs: [
          "By using ayamai, you agree to these terms. You must be at least 18 and meet any higher legal age and access requirements where you are located. Do not use the service if you cannot lawfully access adult material or agree to these terms. The age-confirmation interface is not a guarantee of verified age.",
          "The service centers on adult 3D animation and hentai; lawful adult real-person media is also permitted subject to these rules. The emphasis on animation does not permit sexual depictions of minors or other prohibited content.",
        ],
      },
      {
        id: "accounts",
        title: "2. Accounts, profiles and attribution",
        paragraphs: [
          "Keep your authentication credentials secure, do not impersonate others, and use only accounts and connected services you are authorized to access. Notify privacy@ayamai.io of suspected unauthorized use. You are responsible for activity you authorize; non-waivable legal protections still apply.",
          "You may use an optional pseudonymous profile or anonymous post attribution where offered. Anonymous attribution is anonymity from other viewers, not a promise that the operator or infrastructure providers cannot link activity to your account. Do not expose another member’s identity or private activity without permission.",
          "Membership is by invitation. The owner issues invitations for one verified email at a time. Five total slots cover active invited members and pending invitations; pending invitations expire after 14 days and can be revoked by the owner before acceptance. Each invitation can be accepted once. Do not sell, publicly post or trade invitations. The owner can review invitation and membership records to administer access and investigate abuse; these relationships are not shown on public profiles. Accounts that existed before invitations were introduced remain active. Without an invitation, you may request access at contact@ayamai.io; access is not guaranteed.",
        ],
      },
      {
        id: "content",
        title: "3. Your content, rights and limited permission",
        paragraphs: [
          "You retain the rights you hold in your media, captions, labels and other contributions. You must own or have the necessary permission to upload, store, copy, import and share them for the audience you select. Finding a file online, owning a copy or possessing a source link does not itself give you redistribution rights.",
          "You grant Mark Foster a non-exclusive permission limited to operating ayamai: storing, copying, processing, generating previews, organizing and delivering your contributions according to your chosen audience and enabled product features. Public delivery is authorized only for content you choose to share. This permission is not a transfer of ownership or permission to train a generative AI model.",
          "The operational permission ends when content is removed, except to complete removal, handle required legal preservation, maintain necessary backups for their lifecycle or address an existing dispute. Other people’s independently held rights and copies are not extinguished by deletion.",
        ],
      },
      {
        id: "prohibited",
        title: "4. Prohibited material and conduct",
        paragraphs: [
          "Do not upload, request, share or facilitate child sexual abuse material, sexual depictions of minors (including illustrated, animated or generated depictions), exploitation, trafficking, non-consensual intimate imagery or sexual violence that is unlawful. For real-person intimate material, every depicted person must be an adult and must have consented to its creation and applicable distribution. Non-consensual sexual deepfakes are prohibited.",
          "Do not infringe copyright, privacy or publicity rights; post stolen intimate material or personal identifying information; harass, threaten or impersonate people; upload malware; bypass authentication, age restrictions or access controls; or use the service for unlawful activity.",
          "Do not harvest members’ private media or activity, abuse imports or capture tools, evade provider restrictions, or interfere with the service. Import and browser-capture features are conveniences, not permission to scrape material, bypass paywalls or copy content without rights.",
        ],
      },
      {
        id: "sharing",
        title: "5. Sharing and recommendations",
        paragraphs: [
          "Review audience and attribution before submitting. Shared posts can be viewed and copied by eligible users under the app’s access rules. Private posts are restricted by access controls, not guaranteed end-to-end encrypted or inaccessible to authorized operational review. We cannot guarantee that a viewer will not retain a copy of shared material.",
          "Recommendations use reactions, saves, metadata and enabled behavioral signals. They may be inaccurate or repetitive and do not endorse content or establish its legality. Personal labeling is separate from public hashtags. Collaborative recommendation settings and optional generative-model training are not interchangeable.",
          "Generative AI content creation and training on members’ uploads are not currently offered. No provision here gives blanket training rights over uploads, annotations or viewing history. Any future training program needs separate disclosures, explicit opt-in and appropriate permissions and safeguards.",
        ],
      },
      {
        id: "safety",
        title: "6. Reporting, moderation and removal",
        paragraphs: [
          "Use available in-app reporting controls or email privacy@ayamai.io for safety, consent, copyright or other rights concerns. Identify the affected post or URL and explain your relationship to the concern; do not send illegal material or unnecessary identity documents. We may request information needed to assess a report.",
          "We may restrict, remove or disable content, investigate reports, preserve relevant evidence, suspend accounts or cooperate with lawful authorities where appropriate. We do not promise pre-review of every upload, a fixed response time for every report, or that reporting proves a violation. Explain an error or request reconsideration using the same contact address.",
          "This contact process is not a claim that a statutory copyright agent has been designated or that every jurisdiction’s takedown requirements are satisfied. Statutory rights and obligations continue to apply.",
        ],
      },
      {
        id: "availability",
        title: "7. Availability, backups and payments",
        paragraphs: [
          "Features, storage and connected-provider availability can change or fail. Keep your own backup of anything important. ayamai is not a guaranteed permanent archive, and there is no promised uptime, storage capacity or recovery guarantee.",
          "The current app has no subscription, creator payout, payment-by-view or donation flow. A future paid or donation feature would need separate terms and clear terms before you choose to use it.",
          "The service name, original design and code are protected by applicable rights; you receive only permission to use the service under these terms. Third-party media, names and characters remain subject to their owners’ rights. ayamai is not represented as affiliated with an anime franchise or its rights holders.",
        ],
      },
      {
        id: "termination",
        title: "8. Stopping use and account requests",
        paragraphs: [
          "You can stop using the service and use available controls to delete media, disconnect providers or clear supported history. For full account deletion or a broader data request, contact privacy@ayamai.io; a comprehensive self-service erasure tool is not currently provided. Closing an authentication account alone should not be assumed to erase all application data.",
          "We may suspend or end access for violations, safety, legal requirements or discontinuation of the service. Where appropriate and lawful, we may give notice and an opportunity to address an error. Retention, backups, legal preservation and copies outside our control are subject to the Privacy Policy; no instant universal deletion is promised.",
        ],
      },
      {
        id: "liability",
        title: "9. Disclaimers and limitations",
        paragraphs: [
          "To the extent permitted by law, the service is provided “as is” and “as available,” without warranties of availability, suitability, non-infringement or perfect security. We do not guarantee the accuracy of user content, labels, reviews or recommendations.",
          "To the extent permitted by law, Mark Foster is not liable for indirect, consequential or incidental losses arising from use of the service. Aggregate liability for service-related claims is limited to the greater of US$100 or the amount you paid the operator for the service in the preceding 12 months.",
          "These exclusions do not limit liability, remedies, statutory warranties, privacy rights or consumer protections that cannot lawfully be excluded, including any liability for fraud or other conduct that applicable law prohibits limiting. A qualified attorney should review whether these provisions are suitable for this service and its users.",
        ],
      },
      {
        id: "law",
        title: "10. Changes, governing law and contact",
        paragraphs: [
          "Delaware law governs these terms to the extent permitted by law, without overriding mandatory protections in your jurisdiction. Where an exclusive court choice is lawful, disputes belong in the competent courts of Delaware. These terms do not require arbitration or waive rights that cannot be waived.",
          "The updated date identifies the current draft. Material changes should be communicated through the service or available account channels before taking effect, with any notice or renewed agreement required by law. New sensitive-data uses or AI training are not authorized merely by editing this page.",
          "Operator: Mark Foster. Legal, privacy and content concerns: privacy@ayamai.io. These terms are an informational template and require qualified review for the actual service, including adult-content obligations, consent, age assurance, intellectual property and international access.",
        ],
      },
    ],
  },
};
