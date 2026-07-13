export type RGB = [number, number, number]

export interface EarthFrame {
  phi: number
  theta: number
  time: number
  lightMode: number
  accent: RGB
}

export interface EarthRenderer {
  render: (frame: EarthFrame) => void
  resize: () => void
  destroy: () => void
}

interface Hub {
  location: [number, number]
  size: number
}

// Major AI hubs around the world.
export const AI_HUBS: Hub[] = [
  { location: [37.7749, -122.4194], size: 0.1 },
  { location: [47.6062, -122.3321], size: 0.08 },
  { location: [40.7128, -74.006], size: 0.07 },
  { location: [51.5074, -0.1278], size: 0.06 },
  { location: [48.8566, 2.3522], size: 0.05 },
  { location: [35.6762, 139.6503], size: 0.05 },
  { location: [39.9042, 116.4074], size: 0.05 },
  { location: [12.9716, 77.5946], size: 0.05 },
  { location: [22.3193, 114.1694], size: 0.04 },
  { location: [1.3521, 103.8198], size: 0.04 },
  { location: [37.5665, 126.978], size: 0.04 },
  { location: [43.6532, -79.3832], size: 0.04 },
  { location: [-33.8688, 151.2093], size: 0.03 },
  { location: [52.52, 13.405], size: 0.03 },
  { location: [32.0853, 34.7818], size: 0.03 },
]

const VERTEX_SHADER = `
  attribute vec2 a_position;

  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;

  const float PI = 3.141592653589793;
  const float TWO_PI = 6.283185307179586;
  const float PLANET_RADIUS = 0.73;
  const int HUB_COUNT = 15;

  uniform vec2 u_resolution;
  uniform sampler2D u_map;
  uniform sampler2D u_surface;
  uniform float u_phi;
  uniform float u_theta;
  uniform float u_time;
  uniform float u_light_mode;
  uniform vec3 u_accent;
  uniform vec3 u_hubs[HUB_COUNT];
  uniform float u_hub_sizes[HUB_COUNT];

  vec3 rotateX(vec3 point, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return vec3(
      point.x,
      point.y * cosine - point.z * sine,
      point.y * sine + point.z * cosine
    );
  }

  vec3 rotateY(vec3 point, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return vec3(
      point.x * cosine + point.z * sine,
      point.y,
      -point.x * sine + point.z * cosine
    );
  }

  vec2 worldToUv(vec3 worldNormal) {
    return vec2(
      fract(atan(worldNormal.z, worldNormal.x) / TWO_PI + 0.5),
      0.5 - asin(clamp(worldNormal.y, -1.0, 1.0)) / PI
    );
  }

  float mapAt(vec2 uv) {
    float mask = texture2D(
      u_map,
      vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0))
    ).r;
    return smoothstep(0.22, 0.78, mask);
  }

  // The mipmapped equirect texture shows a bright vertical seam where the
  // longitude coordinate wraps 1 -> 0: the huge uv derivative at the wrap
  // makes the GPU drop to the smallest mip for that pixel column. Sample
  // twice — once in [0,1) space and once in a half-shifted space — and keep
  // the sample whose coordinate sits far from its own discontinuity.
  vec3 surfaceAt(vec2 uv) {
    float v = clamp(uv.y, 0.0, 1.0);
    float u = fract(uv.x);
    vec3 primary = texture2D(u_surface, vec2(u, v)).rgb;
    vec3 shifted = texture2D(u_surface, vec2(fract(uv.x + 0.5) - 0.5, v)).rgb;
    return mix(primary, shifted, step(0.25, abs(u - 0.5)));
  }

  float surfaceHeight(vec2 uv) {
    return dot(surfaceAt(uv), vec3(0.24, 0.63, 0.13)) * mapAt(uv);
  }

  float hash31(vec3 point) {
    point = fract(point * 0.1031);
    point += dot(point, point.yzx + 33.33);
    return fract((point.x + point.y) * point.z);
  }

  float noise3(vec3 point) {
    vec3 cell = floor(point);
    vec3 local = fract(point);
    local = local * local * (3.0 - 2.0 * local);

    return mix(
      mix(
        mix(hash31(cell), hash31(cell + vec3(1.0, 0.0, 0.0)), local.x),
        mix(hash31(cell + vec3(0.0, 1.0, 0.0)), hash31(cell + vec3(1.0, 1.0, 0.0)), local.x),
        local.y
      ),
      mix(
        mix(hash31(cell + vec3(0.0, 0.0, 1.0)), hash31(cell + vec3(1.0, 0.0, 1.0)), local.x),
        mix(hash31(cell + vec3(0.0, 1.0, 1.0)), hash31(cell + vec3(1.0, 1.0, 1.0)), local.x),
        local.y
      ),
      local.z
    );
  }

  float fbm3(vec3 point) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 3; octave++) {
      value += noise3(point) * amplitude;
      point = point * 2.03 + vec3(7.1, 3.7, 5.9);
      amplitude *= 0.5;
    }
    return value / 0.875;
  }

  // Sun direction in view space; normalize(vec3(-0.78, 0.5, 0.62))
  // precomputed so it can be a constant expression.
  const vec3 LIGHT_DIRECTION = vec3(-0.69967, 0.44851, 0.55615);

  void main() {
    vec2 point = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
    point.x *= u_resolution.x / u_resolution.y;
    float radius = length(point);

    vec3 atmosphereColor = mix(
      vec3(0.12, 0.55, 1.0),
      vec3(0.015, 0.32, 0.88),
      u_light_mode
    );
    vec3 lightDirection = LIGHT_DIRECTION;

    if (radius > PLANET_RADIUS) {
      float altitude = radius - PLANET_RADIUS;
      vec2 rimDirection = normalize(point);
      float sunward = 0.45 + 0.55 * max(
        dot(rimDirection, normalize(lightDirection.xy)),
        0.0
      );

      // Three nested scattering shells modelled on orbital limb photos:
      // a crisp horizon line hugging the surface, the main scattering
      // band, and a wide exospheric haze that carries the glow deep into
      // space — together they roughly double the felt atmosphere depth.
      float horizonLine = exp(-altitude * 120.0);
      float scatterBand = exp(-altitude * 24.0);
      float exosphere = exp(-altitude * 10.0);

      vec3 lineColor = mix(
        vec3(0.55, 0.85, 1.0),
        vec3(0.8, 0.94, 1.0),
        u_light_mode
      );
      vec3 bandColor = mix(
        vec3(0.1, 0.45, 1.0),
        vec3(0.04, 0.34, 0.92),
        u_light_mode
      );
      vec3 hazeColor = mix(
        vec3(0.1, 0.22, 0.6),
        vec3(0.1, 0.28, 0.78),
        u_light_mode
      );

      vec3 glow = lineColor * horizonLine * (0.55 + 0.45 * sunward)
        + bandColor * scatterBand * 0.52 * mix(0.78, 1.0, sunward)
        + hazeColor * exosphere * 0.2;
      float alpha = (horizonLine * 0.8 + scatterBand * 0.4 + exosphere * 0.16)
        * mix(0.86, 0.96, u_light_mode)
        * mix(0.78, 1.0, sunward);

      // Airglow: the razor-thin oxygen-green shell that floats a step
      // above the night-side horizon in ISS photography. A quiet accent
      // on the night planet (dark theme), nearly gone in daylight.
      float shellDistance = altitude - 0.04;
      float airglow = exp(-shellDistance * shellDistance * 14000.0)
        * mix(0.2, 0.04, u_light_mode);
      glow += vec3(0.2, 0.85, 0.55) * airglow;
      alpha = clamp(alpha + airglow * 0.45, 0.0, 1.0);

      if (alpha < 0.003) {
        discard;
      }

      // Premultiplied output. iOS WebKit composites WebGL canvases as
      // premultiplied no matter what the context's premultipliedAlpha flag
      // says, so the previous straight-alpha output (glow / alpha) skipped
      // the re-multiply on iPhones and blew the faint outer haze up to full
      // saturation — a hard-edged blue octagon clipped by the square canvas.
      // min(glow, alpha) is exactly what desktop showed before: glow / alpha
      // clamped to 1.0 by the framebuffer, times alpha at composite time.
      gl_FragColor = vec4(min(glow, vec3(alpha)), alpha);
      return;
    }

    float normalizedRadius = radius / PLANET_RADIUS;
    vec3 viewNormal = normalize(vec3(
      point / PLANET_RADIUS,
      sqrt(max(0.0, 1.0 - normalizedRadius * normalizedRadius))
    ));
    vec3 worldNormal = rotateY(rotateX(viewNormal, u_theta), u_phi);

    vec2 uv = worldToUv(worldNormal);
    float land = mapAt(uv);

    // Real topographic shading from the Blue Marble texture perturbs the
    // lighting normal so mountain ranges and coasts have visible relief.
    vec2 surfaceTexel = vec2(1.0 / 1024.0, 1.0 / 512.0);
    float heightEast = surfaceHeight(uv + vec2(surfaceTexel.x, 0.0));
    float heightWest = surfaceHeight(uv - vec2(surfaceTexel.x, 0.0));
    float heightNorth = surfaceHeight(uv - vec2(0.0, surfaceTexel.y));
    float heightSouth = surfaceHeight(uv + vec2(0.0, surfaceTexel.y));
    vec3 east = vec3(-worldNormal.z, 0.0, worldNormal.x);
    if (dot(east, east) < 0.0001) east = vec3(1.0, 0.0, 0.0);
    east = normalize(east);
    vec3 north = normalize(cross(east, worldNormal));
    vec3 reliefNormal = normalize(
      worldNormal
        - east * clamp(heightEast - heightWest, -0.12, 0.12) * 2.05
        - north * clamp(heightNorth - heightSouth, -0.12, 0.12) * 2.05
    );
    vec3 shadedWorldNormal = normalize(mix(worldNormal, reliefNormal, land * 0.9));
    vec3 shadedViewNormal = rotateX(
      rotateY(shadedWorldNormal, -u_phi),
      -u_theta
    );

    vec3 albedo = surfaceAt(uv);
    vec2 mapTexel = vec2(1.0 / 256.0, 1.0 / 128.0);
    float neighboringLand = max(
      max(mapAt(uv + vec2(mapTexel.x, 0.0)), mapAt(uv - vec2(mapTexel.x, 0.0))),
      max(mapAt(uv + vec2(0.0, mapTexel.y)), mapAt(uv - vec2(0.0, mapTexel.y)))
    );
    float shallowWater = (1.0 - land) * neighboringLand;

    float landLuminance = dot(albedo, vec3(0.299, 0.587, 0.114));
    vec3 landColor = pow(albedo, vec3(0.92)) * 1.04;
    landColor = mix(
      vec3(landLuminance),
      landColor,
      1.08
    );

    // Lift the source ocean toward vivid cobalt and azure while preserving
    // the real bathymetry and shallow-water detail.
    vec3 oceanColor = albedo * vec3(1.2, 2.25, 2.08)
      + vec3(0.012, 0.085, 0.145);
    oceanColor = mix(
      oceanColor,
      vec3(0.045, 0.43, 0.72),
      shallowWater * 0.18
    );
    oceanColor = clamp(oceanColor, 0.0, 1.0);

    vec3 surfaceColor = mix(oceanColor, landColor, land);
    float diffuse = dot(normalize(shadedViewNormal), lightDirection);
    float daylight = smoothstep(-0.2, 0.22, diffuse);
    float ambient = mix(0.2, 0.3, u_light_mode);
    surfaceColor *= ambient + max(diffuse, 0.0) * 0.98;

    vec3 halfVector = normalize(lightDirection + vec3(0.0, 0.0, 1.0));
    float reflection = max(dot(normalize(shadedViewNormal), halfVector), 0.0);
    float water = 1.0 - land;
    float oceanSpecular = pow(reflection, 72.0) * water * daylight;
    float oceanSheen = pow(reflection, 10.0) * water * daylight;
    surfaceColor += vec3(0.4, 0.72, 1.0)
      * (oceanSpecular * 0.82 + oceanSheen * 0.1);

    // Satellite-style cloud systems. Domain-warped fbm produces stretched,
    // swirled fronts instead of round blobs; latitude bands emulate real
    // climate structure (cloudy ITCZ at the equator, clear subtropics,
    // stormy mid-latitudes); a density gradient toward the sun gives each
    // cloud a bright rim and a soft self-shadowed core.
    vec3 cloudDrift = vec3(u_time * 0.005, u_time * 0.0016, u_time * 0.003);
    vec3 cloudCoord = worldNormal * 3.3 + cloudDrift;
    float warp = fbm3(cloudCoord * 2.1 + 13.7);
    float cloudBase = fbm3(cloudCoord * 2.7 + warp * 1.55);
    float lat = worldNormal.y;
    float coverage = 0.3
      + 0.17 * exp(-pow(lat * 5.5, 2.0))
      + 0.13 * exp(-pow((abs(lat) - 0.6) * 4.5, 2.0))
      - 0.18 * exp(-pow((abs(lat) - 0.32) * 5.5, 2.0));
    float cloud = smoothstep(
      1.08 - coverage,
      1.38 - coverage,
      cloudBase + warp * 0.42
    );
    // high-frequency erosion keeps edges wispy instead of soft-blurred
    float cloudDetail = noise3(worldNormal * 30.0 + cloudDrift * 3.0);
    cloud *= 0.68 + 0.32 * smoothstep(0.2, 0.8, cloudDetail + cloud * 0.5);
    cloud = clamp(cloud * 1.1, 0.0, 1.0);

    vec3 lightWorld = rotateY(rotateX(lightDirection, u_theta), u_phi);
    float cloudTowardSun = fbm3(
      (worldNormal + lightWorld * 0.05) * 3.3 * 2.7
      + cloudDrift * 2.7
      + warp * 1.55
    );
    float cloudShade = clamp(
      0.62 + (cloudBase - cloudTowardSun) * 2.6,
      0.34,
      1.12
    );

    // cast a soft ground shadow slightly offset from the cloud itself
    surfaceColor *= 1.0 - cloud * daylight * 0.16;
    vec3 cloudColor = mix(
      vec3(0.2, 0.25, 0.36),
      mix(vec3(0.68, 0.74, 0.86), vec3(0.99, 1.0, 1.0), cloudShade),
      daylight
    );
    surfaceColor = mix(
      surfaceColor,
      cloudColor * (0.5 + max(diffuse, 0.0) * 0.62),
      cloud * 0.72
    );

    float metroNoise = noise3(worldNormal * 17.0 + 9.0);
    float streetNoise = noise3(worldNormal * 145.0 + 31.0);
    float urbanLand = smoothstep(0.7, 0.95, land);
    float temperate = 1.0 - smoothstep(0.72, 0.9, abs(worldNormal.y));

    // terminator city lights on the daytime earth (light theme)
    float night = 1.0 - smoothstep(-0.28, 0.16, diffuse);
    float inhabited = smoothstep(0.48, 0.72, metroNoise);
    float cityDetail = smoothstep(0.76, 0.9, streetNoise);
    float city = inhabited * cityDetail * urbanLand * night
      * (1.0 - cloud) * temperate;
    surfaceColor += vec3(1.0, 0.62, 0.27) * city * 1.7;

    // The dark theme flips the planet to its night side: near-black oceans,
    // faint moonlit terrain, silvery cloud silhouettes, and golden city
    // light webs doing the talking. u_light_mode lerps between the two, so
    // toggling the theme reads as a sunset.
    vec3 nightColor = mix(
      vec3(0.014, 0.03, 0.075),
      vec3(0.045, 0.056, 0.082) + landColor * 0.07,
      land
    );
    float moon = 0.45 + 0.55 * max(diffuse, 0.0);
    nightColor *= moon;
    nightColor = mix(
      nightColor,
      vec3(0.075, 0.095, 0.14) * (0.55 + 0.45 * moon),
      cloud * 0.8
    );
    float metro = smoothstep(0.42, 0.68, metroNoise);
    float streets = smoothstep(0.66, 0.86, streetNoise);
    float lightsMask = urbanLand * temperate * (1.0 - cloud * 0.85);
    nightColor += vec3(1.0, 0.6, 0.25) * metro * streets * lightsMask * 2.4;
    // wide, soft urban haze so dense regions glow from orbit
    nightColor += vec3(1.0, 0.55, 0.22) * metro * lightsMask * 0.14;
    surfaceColor = mix(nightColor, surfaceColor, u_light_mode);

    float markerCore = 0.0;
    float markerRing = 0.0;
    float markerGlow = 0.0;
    for (int hubIndex = 0; hubIndex < HUB_COUNT; hubIndex++) {
      float markerScale = 0.72 + u_hub_sizes[hubIndex] * 4.2;
      float markerDistance = 1.0 - dot(worldNormal, u_hubs[hubIndex]);
      markerCore = max(
        markerCore,
        1.0 - smoothstep(0.000025 * markerScale, 0.0002 * markerScale, markerDistance)
      );
      markerRing = max(
        markerRing,
        smoothstep(0.00018 * markerScale, 0.00038 * markerScale, markerDistance)
          * (1.0 - smoothstep(0.00042 * markerScale, 0.0008 * markerScale, markerDistance))
      );
      markerGlow = max(
        markerGlow,
        (1.0 - smoothstep(0.0, 0.0019 * markerScale, markerDistance)) * 0.32
      );
    }
    float markerPulse = 0.88 + 0.12 * sin(u_time * 2.2);
    surfaceColor += u_accent * markerGlow * markerPulse;
    surfaceColor = mix(
      surfaceColor,
      u_accent,
      clamp(markerCore + markerRing * 0.8, 0.0, 1.0)
    );

    // wider fresnel band so the on-disk rim flows into the outer shells
    float fresnel = pow(1.0 - max(viewNormal.z, 0.0), 1.9);
    float rimDaylight = 0.35 + 0.65
      * smoothstep(-0.3, 0.5, dot(viewNormal, lightDirection));
    float atmosphericScatter = fresnel * rimDaylight;
    surfaceColor = mix(
      surfaceColor,
      atmosphereColor,
      clamp(atmosphericScatter * 0.72, 0.0, 0.68)
    );
    surfaceColor += atmosphereColor * atmosphericScatter * 0.24;
    surfaceColor *= mix(1.0, 1.06, u_light_mode);

    gl_FragColor = vec4(surfaceColor, 1.0);
  }
`

// COBE's compact world mask (MIT) separates land and water for material
// lighting. Visible color comes from NASA GSFC's public-domain Blue Marble
// 2002 mosaic, resized to 2048 × 1024 for web delivery.
const EARTH_MASK_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAACAAQAAAADMzoqnAAAAAXNSR0IArs4c6QAABA5JREFUeNrV179uHEUAx/Hf3JpbF+E2VASBsmVKTBcpKJs3SMEDcDwBiVJAAewYEBUivIHT0uUBIt0YCovKD0CRjUC4QfHYh8hYXu+P25vZ2Zm9c66gMd/GJ/tz82d3bk8GN4SrByYF2366FNTACIAkivVAAazQdnf3MvAlbNUQfOPAdQDvSAimMWhwy4I2g4SU+Kp04ISLpPBAKLxPyic3O/CCi+Y7rUJbiodcpDOFY7CgxCEXmdYD2EYK2s5lApOx5pEDDYCUwM1XdJUwBV11QQMg59kePSCaPAASQMEL2hwo6TJFgxpg+TgC2ymXPbuvc40awr3D1QCFfbH9kcoqAOkZozpQo0aqAGQRKCog/+tjkgbNFEtg2FffBvBGlSxHoAaAa1u6X4PBAwDiR8FFsrQgeUhfJTSALaB9jy5NCybJPn1SVFiWk7ywN+KzhH1aKAuydhGkbEF4lWohLXDXavlyFgHY7LBnLRdlAP6BS5Cc8RfVDXbkwN/oIvmY+6obbNeBP0JwTuMGu9gTzy1Q4RS/cWpfzszeYwd+CAFrtBW/Hur0gLbJGlD+/OjVwe/drfBxkbbg63dndEDfiEBlAd7ac0BPe1D6Jd8dfbLH+RI0OzseFB5s01/M+gMdAeluLOCAuaUA9Lezo/vSgXoCX9rtEiXnp7Q1W/CNyWcd8DXoS6jH/YZ5vAJEWY2dXFQe2TUgaFaNejCzJ98g6HnlVrsE58sDcYqg+9XY75fPqdoh/kRQWiXKg8MWlJQxUFMPjqnyujhFBE7UxIMjyszk0QwQlFsezImsyvUYYYVED2pk6m0Tg8T04Fwjk2kdAwSACqlM6gRRt3vQYAFGX0Ah7Ebx1H+MDRI5ui0QldH4j7FGcm90XdxD2Jg1AOEAVAKhEFXSn4cKUELurIAKwJ3MArypPscQaLhJFICJ0ohjDySAdH8AhDtCiTuMycH8CXzhH9jUACAO5uMhoAwA5i+T6WAKmmAqnLy80wxHqIPFYpqCwxGaYLt4Dyievg5kEoVEUAhs6pqKgFtDQYOuaXypaWKQfIuwwoGSZgfLsu/XAtI8cGN+h7Cc1A5oLOMhwlIPXuhu48AIvsSBkvtV9wsJRKCyYLfq5lTrQMFd1a262oqBck9K1V0YjQg0iEYYgpS1A9GlXQV5cykwm4A7BzVsxQqo7E+zCegO7Ma7yKgsuOcfKbMBwLC8wvVNYDsANYalEpOAa6zpWjTeMKGwEwC1CiQewJc5EKfgy7GmRAZA4vUVGwE2dPM/g0xuAInE/yG5aZ8ISxWGfYigUVbdyBElTHh2uCwGdfCkOLGgQVBh3Ewp+/QK4CDlR5Ws/Zf7yhCf8pH7vinWAvoVCQ6zz0NX5V/6GkAVV+2/5qsJ/gU8bsxpM8IeAQAAAABJRU5ErkJggg=='

const EARTH_SURFACE_URL = '/earth/blue-marble-2048.jpg'

const HUB_VECTORS = new Float32Array(
  AI_HUBS.flatMap(({ location: [latitude, longitude] }) => {
    const latitudeRadians = (latitude * Math.PI) / 180
    const longitudeRadians = (longitude * Math.PI) / 180
    const latitudeRadius = Math.cos(latitudeRadians)
    return [
      latitudeRadius * Math.cos(longitudeRadians),
      Math.sin(latitudeRadians),
      latitudeRadius * Math.sin(longitudeRadians),
    ]
  }),
)

const HUB_SIZES = new Float32Array(AI_HUBS.map(({ size }) => size))

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create Earth shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compile error'
    gl.deleteShader(shader)
    throw new Error(message)
  }

  return shader
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  const program = gl.createProgram()

  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    throw new Error('Unable to create Earth program')
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown shader link error'
    gl.deleteProgram(program)
    throw new Error(message)
  }

  return program
}

function loadTexture(
  gl: WebGLRenderingContext,
  source: string,
  textureUnit: number,
  useMipmaps: boolean,
): Promise<WebGLTexture> {
  return new Promise((resolve, reject) => {
    const texture = gl.createTexture()
    if (!texture) {
      reject(new Error('Unable to create Earth texture'))
      return
    }

    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      gl.activeTexture(textureUnit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      )
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        useMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      if (useMipmaps) gl.generateMipmap(gl.TEXTURE_2D)
      resolve(texture)
    }
    image.onerror = () => {
      gl.deleteTexture(texture)
      reject(new Error(`Unable to load Earth texture: ${source}`))
    }
    image.src = source
  })
}

function getUniform(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name)
  if (!location) throw new Error(`Missing Earth uniform: ${name}`)
  return location
}

export async function createEarthRenderer(
  canvas: HTMLCanvasElement,
): Promise<EarthRenderer> {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    depth: false,
    // Must stay true: the fragment shader writes premultiplied colors, and
    // iOS WebKit composites as premultiplied regardless of this flag.
    premultipliedAlpha: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false,
  })

  if (!gl) throw new Error('WebGL is unavailable')

  const program = createProgram(gl)
  const buffer = gl.createBuffer()
  if (!buffer) {
    gl.deleteProgram(program)
    throw new Error('Unable to create Earth geometry')
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]),
    gl.STATIC_DRAW,
  )

  const position = gl.getAttribLocation(program, 'a_position')
  if (position < 0) {
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    throw new Error('Missing Earth position attribute')
  }

  gl.useProgram(program)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const uniforms = {
    resolution: getUniform(gl, program, 'u_resolution'),
    map: getUniform(gl, program, 'u_map'),
    surface: getUniform(gl, program, 'u_surface'),
    phi: getUniform(gl, program, 'u_phi'),
    theta: getUniform(gl, program, 'u_theta'),
    time: getUniform(gl, program, 'u_time'),
    lightMode: getUniform(gl, program, 'u_light_mode'),
    accent: getUniform(gl, program, 'u_accent'),
    hubs: getUniform(gl, program, 'u_hubs[0]'),
    hubSizes: getUniform(gl, program, 'u_hub_sizes[0]'),
  }

  let mapTexture: WebGLTexture
  try {
    mapTexture = await loadTexture(gl, EARTH_MASK_DATA_URI, gl.TEXTURE0, false)
  } catch (error) {
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    throw error
  }

  let surfaceTexture: WebGLTexture
  try {
    surfaceTexture = await loadTexture(
      gl,
      EARTH_SURFACE_URL,
      gl.TEXTURE1,
      true,
    )
  } catch (error) {
    gl.deleteTexture(mapTexture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    throw error
  }
  gl.useProgram(program)
  gl.uniform1i(uniforms.map, 0)
  gl.uniform1i(uniforms.surface, 1)
  gl.uniform3fv(uniforms.hubs, HUB_VECTORS)
  gl.uniform1fv(uniforms.hubSizes, HUB_SIZES)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.CULL_FACE)

  const resize = () => {
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio))
    const height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio))

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }
  }

  const render = ({ phi, theta, time, lightMode, accent }: EarthFrame) => {
    gl.useProgram(program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, mapTexture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, surfaceTexture)
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
    gl.uniform1f(uniforms.phi, phi)
    gl.uniform1f(uniforms.theta, theta)
    gl.uniform1f(uniforms.time, time)
    gl.uniform1f(uniforms.lightMode, lightMode)
    gl.uniform3f(uniforms.accent, accent[0], accent[1], accent[2])
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  const destroy = () => {
    gl.deleteTexture(mapTexture)
    gl.deleteTexture(surfaceTexture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }

  resize()
  return { render, resize, destroy }
}
