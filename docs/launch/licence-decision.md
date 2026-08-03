# Pulsii repository licence decision

Prepared for review on `agent/pulsii-restoration`. This note is not legal
advice and does not select or apply a licence.

## Current state

Pulsii is in a public GitHub repository, but it has no `LICENSE` file and its
`package.json` is deliberately marked `"private": true` and
`"license": "UNLICENSED"`.

Public visibility is not the same as an open-source grant. GitHub's
[licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
states that, without a licence, default copyright law applies: the owner keeps
the rights to reproduce, distribute, and create derivative works, subject to
GitHub users' platform rights to view and fork a public repository.

That state is acceptable for an isolated, unindexed technical review. It is not
a clear long-term position for a public launch, outside contributions, or code
reuse.

## Practical choices

| Choice | What it supports | Main trade-off for Pulsii |
|---|---|---|
| Keep all rights reserved | Maximum control while the product, name, and profit route are tested | Others have no general permission to reuse or contribute; the public repository can still be viewed and forked on GitHub |
| MIT | Very simple permissive open source; reuse, modification, redistribution, sublicensing, and commercial use are permitted when the notice is retained | A competing hosted service can reuse the code without publishing its changes |
| AGPL-3.0 | Open source with reciprocity for modified versions used through a network service | More compliance work and integration friction; Pulsii must provide corresponding source to users when the licence's network clause applies |

The [OSI MIT text](https://opensource.org/license/mit) grants broad reuse,
including commercial use, subject principally to preserving its copyright and
permission notice. The [GNU explanation of AGPL-3.0](https://www.gnu.org/licenses/why-affero-gpl.html.en)
describes its additional network requirement: users of a modified server
version must be able to obtain the corresponding source.

Do not create a custom licence. Standard licences are easier for contributors,
hosting providers, dependency scanners, and future partners to understand.

## Recommendation for the review deployment

Keep the repository `UNLICENSED` for the isolated review. Do not add a licence
merely to meet the August 5 technical-preview target.

Choose before merging for a broader public launch or accepting contributions:

- Choose **all rights reserved** if the priority is retaining exclusive control
  while paid private rooms, events, sponsorship, or acquisition interest are
  tested.
- Choose **MIT** if the priority is reach, reuse, teaching value, and the lowest
  barrier to outside participation—even if others build commercial versions.
- Choose **AGPL-3.0** if the priority is an open community project whose modified
  hosted versions should remain available to their users as source.

Pulsii's current commercial uncertainty favours keeping all rights reserved
through the first controlled beta. Evidence from that beta can then inform
whether distribution or code exclusivity matters more. This does not prevent a
later move to MIT or AGPL while the copyright remains under the owner's control.

## Decisions the owner must make

Record these together; they should not be inferred from deployment approval:

1. Is Pulsii primarily a proprietary product, an open web experiment, or an
   open project with network reciprocity?
2. May other people operate commercial Pulsii forks without publishing their
   changes?
3. Will outside code contributions be accepted? If so, under what contributor
   terms will Pulsii preserve the ability to relicense later?
4. Are the name, Penrose icon, launch graphics, and other brand assets covered
   by the software licence, or explicitly reserved under separate terms?

If legal ownership or prior contributions are uncertain, confirm them before
changing the licence and obtain qualified legal advice for a decision intended
to support a business.

## Implementation checklist after a decision

Make the eventual change as its own reviewable commit:

1. Add the unmodified canonical licence text in a root `LICENSE` file, or add a
   concise all-rights-reserved notice if that is the decision.
2. Replace `"UNLICENSED"` in `package.json` with the correct SPDX identifier
   only when an open-source licence is actually granted. Keep `"private": true`
   unless package publication is separately intended.
3. Add a short licensing section to `README.md` and distinguish code from any
   separately reserved name and visual assets.
4. Add contribution terms before accepting outside patches if future
   relicensing or dual licensing must remain possible.
5. Re-run the repository checks and confirm GitHub detects the intended licence.

No licence file, rights grant, repository-visibility change, or contributor
policy is authorised by this note.
