# Sydney VPS options for Radio Net (checked 9 Oct 2026, NZ time)

Need: Sydney region, ~2 vCPU / 2-4 GB, public IPv4, UDP allowed (all of these allow it). Audio-only LiveKit for ~20 people is light; 2 GB is enough for M1/M2.
NZD at US$1 = NZ$1.785 (open.er-api.com, 9 Oct 2026). Prices exclude GST; expect NZ GST (15%) to be added for an NZ customer.

| Provider | Plan | Specs | US$/mo | ≈ NZ$/mo (ex GST) | Notes | Source |
|---|---|---|---|---|---|---|
| **Vultr** (Sydney, also Melbourne) | Regular Performance `vc2-2c-2gb` | 2 vCPU, 2 GB, 65 GB SSD, 3 TB | **15** | **≈ 27** | Hourly billing, simple UI, cloud-init "User data" field, IPv4 included. `vc2-2c-4gb` (4 GB, 80 GB) is US$20 ≈ NZ$36. | [vultr.com/pricing](https://www.vultr.com/pricing/), [ServerSearcher AU 2-vCPU list, 8 Oct](https://www.serversearcher.com/servers/answers/cheapest-2-vcpu-vps-in-australia/) |
| DigitalOcean (SYD1) | Basic `s-2vcpu-2gb` | 2 vCPU, 2 GB, 60 GB, 3 TB | 18 | ≈ 32 | Good docs; cloud firewall free. | [ServerSearcher](https://www.serversearcher.com/servers/answers/cheapest-2-vcpu-vps-in-australia/), [DO pricing](https://www.digitalocean.com/pricing/droplets) |
| Akamai / Linode (Sydney, Melbourne) | Shared `Linode 4 GB` | 2 vCPU, 4 GB, 80 GB, 4 TB | 24 | ≈ 43 | The 2 GB plan is only 1 vCPU (US$12). | [Akamai APAC pricing](https://www.akamai.com/cloud/pricing/asia-pacific) |
| AWS Lightsail (ap-southeast-2 Sydney) | `Small-2GB` with IPv4 | 2 vCPU (burstable), 2 GB, 60 GB | 12 | ≈ 21 | Cheapest, but burstable CPU and a heavier AWS sign-up; data allowance varies by region (reported halved in Sydney). 4 GB = US$24. | [Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [pricing](https://aws.amazon.com/lightsail/pricing/) |
| Hetzner | — | — | — | — | **No Sydney/Australia region** (Germany, Finland, US East/West, Singapore). Singapore adds ~90-100 ms from NZ. Not suitable. | [Hetzner locations](https://docs.hetzner.com/cloud/general/locations/) |

## Recommendation

**Vultr, Sydney, Regular Performance 2 vCPU / 2 GB (US$15 ≈ NZ$27/mo + GST ≈ NZ$31).** Hourly billing, so a test night costs cents and we can delete or upsize to 4 GB (US$20) in one click. Simple sign-up and a User-data box for `cloud-init.yaml`.

Tobias's step: create a Vultr account (email + card; Vultr may ask for a small card pre-auth or ID check), then either deploy the instance himself (Sydney, Ubuntu 24.04, `vc2-2c-2gb`, paste `cloud-init.yaml`) and send the IP, or tell the agent to walk him through it. No API keys or passwords need to be shared.
