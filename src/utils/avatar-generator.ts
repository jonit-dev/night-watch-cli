/**
 * Generates persona avatars using Replicate's Flux 1.1 Pro model.
 * Output URLs are valid for ~1 hour; Slack caches them on first display.
 */

const REPLICATE_MODEL = 'black-forest-labs/flux-1.1-pro';
const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 60; // 3 minutes max

interface IReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[];
  error?: string;
}

function buildAvatarPrompt(role: string): string {
  const lower = role.toLowerCase();

  let descriptor: string;
  if (lower.includes('security')) {
    descriptor = 'sharp-eyed cybersecurity professional, serious and analytical expression, dark blazer';
  } else if (lower.includes('architect') || lower.includes('tech lead') || lower.includes('lead')) {
    descriptor = 'confident senior software architect, composed and thoughtful expression, business casual';
  } else if (lower.includes('qa') || lower.includes('quality')) {
    descriptor = 'meticulous quality engineer, focused and detail-oriented expression, smart casual';
  } else if (lower.includes('implement') || lower.includes('developer') || lower.includes('engineer')) {
    descriptor = 'energetic software developer, creative and approachable expression, casual tech style';
  } else if (lower.includes('product') || lower.includes('manager')) {
    descriptor = 'product manager, strategic and empathetic expression, business professional';
  } else if (lower.includes('design')) {
    descriptor = 'UX/UI designer, creative and innovative expression, modern stylish attire';
  } else {
    descriptor = 'professional software team member, friendly and competent expression, smart casual';
  }

  return (
    `Professional headshot portrait photo of a ${descriptor}, ` +
    `photorealistic, clean soft light gray background, diffused studio lighting, ` +
    `sharp focus, looking directly at camera, high quality portrait photography, cinematic`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generatePersonaAvatar(
  personaRole: string,
  apiToken: string,
): Promise<string | null> {
  const prompt = buildAvatarPrompt(personaRole);

  console.log(`[avatar] Generating avatar for role: ${personaRole}`);

  const createRes = await fetch(
    `https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: {
          prompt,
          aspect_ratio: '1:1',
          output_format: 'webp',
          output_quality: 85,
        },
      }),
    },
  );

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Replicate create failed (${createRes.status}): ${body}`);
  }

  let prediction = (await createRes.json()) as IReplicatePrediction;

  // If the Prefer: wait header resolved it immediately
  if (prediction.status === 'succeeded') {
    const url = prediction.output?.[0] ?? null;
    console.log(`[avatar] Generated: ${url}`);
    return url;
  }

  // Poll until done
  for (let i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await fetch(
      `https://api.replicate.com/v1/predictions/${prediction.id}`,
      { headers: { Authorization: `Bearer ${apiToken}` } },
    );

    if (!pollRes.ok) continue;

    prediction = (await pollRes.json()) as IReplicatePrediction;

    if (prediction.status === 'succeeded') {
      const url = prediction.output?.[0] ?? null;
      console.log(`[avatar] Generated: ${url}`);
      return url;
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      throw new Error(
        `Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`,
      );
    }

    console.log(`[avatar] Polling… status=${prediction.status} (${i + 1}/${MAX_POLLS})`);
  }

  throw new Error('Replicate avatar generation timed out after 3 minutes');
}
