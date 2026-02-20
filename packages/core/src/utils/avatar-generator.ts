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
  output?: string | string[];
  error?: string;
}

function extractOutputUrl(output: string | string[] | undefined): string | null {
  if (!output) return null;
  return Array.isArray(output) ? (output[0] ?? null) : output;
}

/**
 * Persona-specific portrait descriptions.
 * Each persona gets a distinct, memorable appearance — not a generic stock photo.
 */
const PERSONA_PORTRAITS: Record<string, string> = {
  maya: [
    'South Asian woman in her late 20s with sharp dark eyes and straight black hair pulled back in a low ponytail',
    'wearing a dark charcoal blazer over a plain black turtleneck',
    'expression is focused and perceptive — the look of someone who notices details others miss',
    'minimal jewelry, small silver stud earrings',
  ].join(', '),

  carlos: [
    'Hispanic man in his mid-30s with short dark wavy hair and a neatly trimmed beard',
    'wearing a navy blue henley shirt with sleeves slightly pushed up',
    'expression is calm and confident — easy authority, like someone used to making decisions',
    'slight smile that reads more thoughtful than warm',
  ].join(', '),

  priya: [
    'Indian woman in her early 30s with shoulder-length dark brown hair with subtle highlights',
    'wearing a soft olive green cardigan over a white crew-neck t-shirt',
    'expression is alert and curious — bright eyes, slight head tilt, like she just thought of something interesting',
    'round tortoiseshell glasses',
  ].join(', '),

  dev: [
    'East Asian man in his late 20s with short textured black hair styled casually',
    'wearing a heather gray crewneck sweatshirt',
    'expression is friendly and approachable — relaxed confidence, like someone in the middle of good work',
    'clean-shaven, natural look',
  ].join(', '),
};

function buildAvatarPrompt(personaName: string, role: string): string {
  const nameKey = personaName.toLowerCase();
  const personaDescription = PERSONA_PORTRAITS[nameKey];

  if (personaDescription) {
    return (
      `Professional headshot portrait photo of a ${personaDescription}, ` +
      `photorealistic, clean soft neutral background, natural diffused window lighting, ` +
      `shot at f/2.8, shallow depth of field, looking directly at camera, ` +
      `candid professional headshot style, no retouching artifacts, natural skin texture`
    );
  }

  // Fallback for custom personas — generate based on role
  const lower = role.toLowerCase();

  let descriptor: string;
  if (lower.includes('security')) {
    descriptor = 'sharp-eyed cybersecurity professional with a serious and analytical expression, wearing a dark blazer';
  } else if (lower.includes('architect') || lower.includes('tech lead') || lower.includes('lead')) {
    descriptor = 'confident senior software architect with a composed and thoughtful expression, business casual attire';
  } else if (lower.includes('qa') || lower.includes('quality')) {
    descriptor = 'meticulous quality engineer with a focused and detail-oriented expression, smart casual attire';
  } else if (lower.includes('implement') || lower.includes('developer') || lower.includes('engineer')) {
    descriptor = 'software developer with a creative and approachable expression, casual tech attire';
  } else if (lower.includes('product') || lower.includes('manager')) {
    descriptor = 'product manager with a strategic and empathetic expression, business professional attire';
  } else if (lower.includes('design')) {
    descriptor = 'UX/UI designer with a creative and innovative expression, modern stylish attire';
  } else {
    descriptor = 'professional software team member with a friendly and competent expression, smart casual attire';
  }

  return (
    `Professional headshot portrait photo of a ${descriptor}, ` +
    `photorealistic, clean soft neutral background, natural diffused window lighting, ` +
    `shot at f/2.8, shallow depth of field, looking directly at camera, ` +
    `candid professional headshot style, no retouching artifacts, natural skin texture`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generatePersonaAvatar(
  personaName: string,
  personaRole: string,
  apiToken: string,
): Promise<string | null> {
  const prompt = buildAvatarPrompt(personaName, personaRole);

  console.log(`[avatar] Generating avatar for ${personaName} (${personaRole})`);

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
    const url = extractOutputUrl(prediction.output);
    console.log(`[avatar] Generated for ${personaName}: ${url}`);
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
      const url = extractOutputUrl(prediction.output);
      console.log(`[avatar] Generated for ${personaName}: ${url}`);
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
