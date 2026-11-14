# GNSS Satellite Attitude Laws and Yaw-Steering Reference

**Date:** 2026-11-14  
**Scope:** Authoritative mathematical specification of nominal, rate-limited, smoothed, and orbit-normal attitude laws across all GNSS constellations and spacecraft blocks tracked in `igs_satellite_metadata.snx` and [`models/catalog.json`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/catalog.json), aligned with the GNSS Studio body-frame and glTF 3D model conventions.

---

## 1. Reference Frame, Angles, and Project Conventions

### 1.1 Spacecraft Body Frame (`+Z` Nadir, `+Y` Solar Axis, `+X` Sun Half-Plane)

Following the project specification and the IGS/Montenbruck convention (Montenbruck et al., 2015), the spacecraft body-fixed frame $\mathcal{B} = \{\hat{\mathbf{X}}_B, \hat{\mathbf{Y}}_B, \hat{\mathbf{Z}}_B\}$ has its origin at the satellite center of mass / geometric bus center and is defined as:

| Axis | Definition | Physical Alignment |
|---|---|---|
| **$+\mathbf{Z}_B$** | Nadir / Earth-pointing | Navigation L-band antenna boresight, $-\hat{\mathbf{r}} = -\mathbf{r}/\|\mathbf{r}\|$ (except NavIC regional target-pointing offset; §3.8). |
| **$+\mathbf{Y}_B$** | Solar-array rotation axis | SADM drive axis (`wing+Y` / `wing-Y`); orthogonal to the Sun unit vector $\hat{\mathbf{s}}$ under nominal yaw steering ($\hat{\mathbf{s}} \cdot \hat{\mathbf{Y}}_B = 0$). |
| **$+\mathbf{X}_B$** | Completes right-handed triad | $\hat{\mathbf{X}}_B = \hat{\mathbf{Y}}_B \times \hat{\mathbf{Z}}_B$, constrained under nominal yaw steering so that the Sun lies in the $(+\mathbf{X}_B, \pm\mathbf{Z}_B)$ half-plane ($\hat{\mathbf{s}} \cdot \hat{\mathbf{X}}_B \ge 0$). |

> [!IMPORTANT]
> **Reconciliation with Project `.glb` Model Geometry (`cell_side = "-x"`) and Manufacturer Frames:**
> 1. In [`models/galileo-foc/NOTES.md`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/galileo-foc/NOTES.md) and [`models/_tools/proc_lib.py`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/_tools/proc_lib.py#L778-L781) (`build_sadm_and_wings(..., cell_side="-x")`), all procedural `.glb` models are built with solar cells facing **`-X_model`** at identity wing rotation (matching the Galileo GSC/OHB mechanical frame where `+X_mech` is the deep-space/clock radiator face and `-X_mech` is the Sun-facing side).
> 2. Therefore, `X_IGS = -X_model`, `Y_IGS = -Y_model`, `Z_IGS = +Z_model` (a $180^\circ$ rotation about $+\mathbf{Z}_B$). When attaching a `.glb` to the $\mathcal{B}$ frame defined above, either rotate the model root by $180^\circ$ about $+\mathbf{Z}_B$ (recommended, so bus radiators/sensors also face the correct Sun/deep-space hemisphere), or add $+180^\circ$ to the solar-wing pitch angle if only solar-cell alignment is considered.
> 3. Blender exports `.glb` with glTF $+Y$-up: $\text{glTF}\,(x, y, z) = \text{body}\,(x, z, -y)$, so body $+\mathbf{Y}_B$ maps to glTF $-\mathbf{Z}$, and body $+\mathbf{Z}_B$ maps to glTF $+\mathbf{Y}$.
> 4. Two node naming patterns exist in [`models/catalog.json`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/catalog.json): `galileo-foc` uses `["solar_wing_+Y", "solar_wing_-Y"]`, while all other GNSS models use `["wing+Y", "wing-Y"]`.

### 1.2 Orbit-Normal Frame $\mathcal{O}$, Sun Elevation $\beta$, and Orbit Angle $\mu$

Let $\mathbf{r}$ and $\mathbf{v} = \mathbf{v}_{\text{ECI}} = \mathbf{v}_{\text{ECEF}} + \boldsymbol{\omega}_\oplus \times \mathbf{r}$ be the satellite inertial position and velocity vectors, and $\hat{\mathbf{s}}$ be the unit vector from the satellite (or Earth center) toward the Sun. Define the **Orbit-Normal (ON) reference frame** $\mathcal{O} = \{\hat{\mathbf{x}}_{\text{ON}}, \hat{\mathbf{y}}_{\text{ON}}, \hat{\mathbf{z}}_{\text{ON}}\}$ (matching [`bodyFrame`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/web/src/cesium/sensorGeometry.ts#L79-L90) in [`web/src/cesium/sensorGeometry.ts`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/web/src/cesium/sensorGeometry.ts)):

$$
\hat{\mathbf{z}}_{\text{ON}} = -\frac{\mathbf{r}}{\|\mathbf{r}\|}, \qquad
\hat{\mathbf{h}} = \frac{\mathbf{r} \times \mathbf{v}}{\|\mathbf{r} \times \mathbf{v}\|}, \qquad
\hat{\mathbf{y}}_{\text{ON}} = -\hat{\mathbf{h}}, \qquad
\hat{\mathbf{x}}_{\text{ON}} = \hat{\mathbf{y}}_{\text{ON}} \times \hat{\mathbf{z}}_{\text{ON}}
$$

(Note that for a circular orbit $\hat{\mathbf{x}}_{\text{ON}} = \hat{\mathbf{v}}$, pointing along-track in the direction of motion.)

Projecting the Sun unit vector $\hat{\mathbf{s}}$ onto $\mathcal{O}$ gives $(s_x, s_y, s_z)^T = (\hat{\mathbf{s}} \cdot \hat{\mathbf{x}}_{\text{ON}},\; \hat{\mathbf{s}} \cdot \hat{\mathbf{y}}_{\text{ON}},\; \hat{\mathbf{s}} \cdot \hat{\mathbf{z}}_{\text{ON}})^T$:

- **Sun elevation angle $\beta \in [-90^\circ, +90^\circ]$** (angle of $\hat{\mathbf{s}}$ above the orbital plane, positive toward $+\hat{\mathbf{h}} = -\hat{\mathbf{y}}_{\text{ON}}$):
  $$\sin\beta = \hat{\mathbf{s}} \cdot \hat{\mathbf{h}} = -s_y \quad \Longrightarrow \quad \beta = \arcsin(-s_y)$$

- **Orbit angle $\mu \in (-180^\circ, +180^\circ]$** (geocentric orbit angle measured from **orbit midnight** in the direction of orbital motion, $\dot{\mu} > 0$):
  $$s_x = \cos\beta \sin\mu, \qquad s_y = -\sin\beta, \qquad s_z = \cos\beta \cos\mu$$
  $$\mu = \operatorname{atan2}(s_x,\, s_z)$$
  - $\mu = 0^\circ$: **Orbit midnight** (satellite on anti-Sun side of Earth; $s_z = +\cos\beta$).
  - $\mu = \pm 180^\circ$: **Orbit noon** (satellite on Sun side of Earth; $s_z = -\cos\beta$).
  - $\mu = +90^\circ$ / $-90^\circ$: Dawn / dusk quadratures ($s_x = \pm\cos\beta$, $s_z = 0$).

- **Collinearity angle $\epsilon \in [0^\circ, 180^\circ]$** (angle between satellite-to-Sun vector $\hat{\mathbf{s}}$ and nadir/anti-nadir axis, i.e., $\cos\epsilon = |s_z|$ or $\epsilon = \arccos(\pm s_z)$ depending on noon vs. midnight):
  $$\sin\epsilon = \sqrt{s_x^2 + s_y^2} = \sqrt{1 - \cos^2\beta \cos^2\mu}$$

### 1.3 Yaw Angle $\psi$, Yaw Rate $\dot{\psi}$, and Solar Wing Pitch $\theta_{\text{SA}}$

The body frame $\mathcal{B}$ is obtained by rotating $\mathcal{O}$ around $+\hat{\mathbf{z}}_{\text{ON}}$ by the **yaw angle $\psi$** (right-handed positive rotation from $+\hat{\mathbf{x}}_{\text{ON}}$ toward $+\hat{\mathbf{y}}_{\text{ON}}$):

$$
\begin{bmatrix} \hat{\mathbf{X}}_B \\ \hat{\mathbf{Y}}_B \\ \hat{\mathbf{Z}}_B \end{bmatrix}
=
\begin{bmatrix}
\cos\psi & \sin\psi & 0 \\
-\sin\psi & \cos\psi & 0 \\
0 & 0 & 1
\end{bmatrix}
\begin{bmatrix} \hat{\mathbf{x}}_{\text{ON}} \\ \hat{\mathbf{y}}_{\text{ON}} \\ \hat{\mathbf{z}}_{\text{ON}} \end{bmatrix}
$$

The Sun unit vector in body coordinates $\mathcal{B}$ is $\hat{\mathbf{s}}_B = (s_{Bx}, s_{By}, s_{Bz})^T$:

$$
s_{Bx} = s_x \cos\psi + s_y \sin\psi, \qquad
s_{By} = -s_x \sin\psi + s_y \cos\psi, \qquad
s_{Bz} = s_z
$$

For solar cells whose zero-pitch normal faces $+\hat{\mathbf{X}}_B$, a right-handed SADM pitch rotation $\theta_{\text{SA}}$ about $+\hat{\mathbf{Y}}_B$ yields panel normal $(\cos\theta_{\text{SA}}, 0, -\sin\theta_{\text{SA}})^T$, so optimal Sun tracking gives:

$$
\theta_{\text{SA}}^{+X} = \operatorname{atan2}(-s_{Bz},\, s_{Bx})
$$

*(If applied directly to a raw `.glb` wing node with `cell_side = "-x"` without rotating the root by $180^\circ$ about $Z$, the cell normal is $(-\cos\theta, 0, +\sin\theta)^T$, giving $\theta_{\text{SA}}^{-X} = \operatorname{atan2}(s_{Bz}, -s_{Bx}) = \theta_{\text{SA}}^{+X} + \pi$.)*

> [!NOTE]
> **Sign Convention Reconciliation Across Agencies:**
> Some agency documents (e.g., GSC Galileo metadata and QZSS `SPI-QZS1R`) define $+X_{\text{mech}}$ away from the Sun (Sun on $-X$) and/or measure orbit angle $\eta$ from **orbit noon** ($\eta = \mu - 180^\circ$). Shifting $+X \to -X$ adds $180^\circ$ to $\psi$, changing $\operatorname{atan2}(-\tan\beta, \sin\mu)$ to $\operatorname{atan2}(\tan\beta, -\sin\mu)$. All equations below are expressed consistently in the **IGS / project frame** ($+X_B$ toward the Sun, $\mu$ from midnight), with agency-native conventions noted where relevant.

---

## 2. Nominal Yaw Steering (YS) and Orbit-Normal (ON) Definitions

### 2.1 Nominal Yaw Steering (YS)

Enforcing $\hat{\mathbf{s}} \cdot \hat{\mathbf{Y}}_B = s_{By} = 0$ and $\hat{\mathbf{s}} \cdot \hat{\mathbf{X}}_B = s_{Bx} \ge 0$ yields the universal GNSS **Nominal Yaw Steering** law (Bar-Sever, 1996; Kouba, 2009; Montenbruck et al., 2015):

$$
\psi_{\text{nom}}(\beta, \mu) = \operatorname{atan2}(s_y,\, s_x) = \operatorname{atan2}(-\tan\beta,\, \sin\mu) \quad (|\beta| < 90^\circ)
$$

Differentiating with respect to time ($\dot{\mu} \approx n = \sqrt{GM_\oplus / a^3}$ for near-circular orbits, with $\dot{\beta} \approx 0$ over one orbital revolution):

$$
\dot{\psi}_{\text{nom}}(\beta, \mu) = \frac{\tan\beta \cos\mu}{\sin^2\mu + \tan^2\beta}\,\dot{\mu}
$$

Peak nominal yaw rate occurs at orbit midnight ($\mu = 0^\circ$) and orbit noon ($\mu = 180^\circ$):

$$
|\dot{\psi}_{\text{nom}}|_{\max} = \frac{\dot{\mu}}{|\tan\beta|}
$$

As $\beta \to 0^\circ$, $|\dot{\psi}_{\text{nom}}|_{\max} \to \infty$, exceeding spacecraft reaction-wheel / thruster yaw rate limits $R$. All non-nominal GNSS attitude laws exist specifically to resolve this collinearity singularity at low $|\beta|$.

| Constellation | Nominal Orbit Period $T$ | Mean Orbital Angular Rate $\dot{\mu}$ |
|---|---|---|
| GPS (MEO, $a \approx 26{,}560\text{ km}$) | $\approx 11\text{ h } 58\text{ m}$ ($43{,}080\text{ s}$) | $\approx 0.00836^\circ/\text{s}$ |
| GLONASS (MEO, $a \approx 25{,}510\text{ km}$) | $\approx 11\text{ h } 16\text{ m}$ ($40{,}548\text{ s}$) | $\approx 0.00888^\circ/\text{s}$ |
| Galileo (MEO, $a \approx 29{,}600\text{ km}$) | $\approx 14\text{ h } 05\text{ m}$ ($50{,}680\text{ s}$) | $\approx 0.00710^\circ/\text{s}$ |
| BeiDou-3 MEO ($a \approx 27{,}906\text{ km}$) | $\approx 12\text{ h } 53\text{ m}$ ($46{,}396\text{ s}$) | $\approx 0.00776^\circ/\text{s}$ |
| IGSO / GEO (BDS, QZSS, NavIC, $a \approx 42{,}164\text{ km}$) | $\approx 23\text{ h } 56\text{ m}$ ($86{,}164\text{ s}$) | $\approx 0.00418^\circ/\text{s}$ |

### 2.2 Orbit-Normal (ON) Mode

In **Orbit-Normal (ON)** mode, the spacecraft locks its axes directly to $\mathcal{O}$ (zero yaw relative to the orbital frame):

$$
\psi_{\text{ON}} = 0^\circ \quad (\text{or } 180^\circ \text{ if body } +X \text{ faces anti-flight}), \qquad \dot{\psi}_{\text{ON}} = 0
$$

- $+\mathbf{Z}_B = \hat{\mathbf{z}}_{\text{ON}}$ (nadir).
- $+\mathbf{Y}_B = \hat{\mathbf{y}}_{\text{ON}} = -\hat{\mathbf{h}}$ (anti-orbit-normal, fixed perpendicular to the orbital plane).
- $+\mathbf{X}_B = \hat{\mathbf{x}}_{\text{ON}}$ (along-track velocity direction).
- In ON mode, the solar panels still pitch about $+\mathbf{Y}_B$ to follow the in-plane Sun component ($\theta_{\text{SA}}^{+X} = \operatorname{atan2}(-s_z, s_x)$), suffering a geometric cosine power loss proportional to $\cos\beta$ (acceptable only when $|\beta|$ is small, or for GEO/IGSO thermal designs).

---

## 3. Constellation- and Block-Specific Attitude Laws

### 3.1 Master Summary Table

| Constellation / Block | IGS SNX `block` Strings | Low-$|\beta|$ Regime | Turn / Transition Law | Max Yaw Rate $R$ | Primary References |
|---|---|---|---|---|---|
| **GPS IIR / IIR-M** | `GPS-IIR-A`, `GPS-IIR-B`, `GPS-IIR-M` | $|\beta| \lesssim 2.4^\circ$ | Rate-limited noon & midnight turns (centered) | $0.20^\circ/\text{s}$ | Bar-Sever (1996); Kouba (2009) |
| **GPS IIF** | `GPS-IIF` | Noon: $\|\beta\| \lesssim 4.35^\circ$; Shadow: $\|\beta\| \lesssim 13.5^\circ$ | Noon: rate-limited ($-0.7^\circ$ bias anomaly); Shadow: linear across umbra/penumbra | Noon: $0.11^\circ/\text{s}$; Shadow: $\sim 0.05\text{–}0.11^\circ/\text{s}$ | Kouba (2009, 2017); Dilssner (2010); Kuang et al. (2017) |
| **GPS III** | `GPS-III`, `GPS-IIIA`, `GPS-III-1` | $|\beta| \lesssim 5.8^\circ$ | Symmetric smoothed rate-limited yaw steering (~1 h slew) | $0.082^\circ/\text{s}$ | Montenbruck et al. (2026); Steigenberger et al. |
| **GLONASS-M** | `GLO-M`, `GLO-M+` | Noon: $\|\beta\| \lesssim 2.0^\circ$; Shadow: $\|\beta\| \lesssim 14.2^\circ$ | Noon: centered max-rate slew; Midnight: triggered at shadow entry, then constant hold | $0.25^\circ/\text{s}$ | Dilssner et al. (2011) |
| **GLONASS-K1 / K2** | `GLO-K1`, `GLO-K1+`, `GLO-K1A`, `GLO-K1B`, `GLO-K2` | $|\beta| \lesssim 2.0^\circ$ | Symmetric centered noon & midnight turns (ramp-up / const / ramp-down); K2 also broadcasts parameters in CDMA nav | $0.25^\circ/\text{s}$ ($0.24987^\circ/\text{s}$) | Dilssner & Springer; Steigenberger et al. (2024) |
| **Galileo IOV** | `GAL-1` | $\|S_{ox}\| < \sin 15^\circ$ & $\|S_{oy}\| < \sin 2^\circ$ | Auxiliary Sun reference vector $\vec{S}_H$ cosine blend ($\beta_x = 15^\circ, \beta_y = 2^\circ$) | $< 0.2^\circ/\text{s}$ (smooth) | GSC Galileo Metadata; Montenbruck et al. (2015) |
| **Galileo FOC** | `GAL-2` | $|\beta| < 4.1^\circ$ & $\epsilon < 10.0^\circ$ | GSC time-domain cosine transition ($T_{\text{period}} = 5656\text{ s}$, half-turn $2828\text{ s}$) | $\approx 0.10^\circ/\text{s}$ peak (smooth) | GSC Galileo Metadata |
| **BeiDou-2 GEO** | `BDS-2G` | Always | Permanent Orbit-Normal ($\psi = 0^\circ$) | $0^\circ/\text{s}$ | Guo et al. (2016); Montenbruck et al. (2015) |
| **BeiDou-2 IGSO/MEO** | `BDS-2I`, `BDS-2M` | $|\beta| \le 4.0^\circ$ (legacy) | Abrupt YS $\leftrightarrow$ ON switch at $|\beta| = 4^\circ$; 2017–2018 firmware upgrade migrated select PRNs (e.g. C14, C06, C13, C16) to CYS | Legacy ON: $0$; CYS: smoothed | Guo et al. (2016); Wang et al. (2018); Xia et al. (2019) |
| **BeiDou-3 GEO** | `BDS-3G` | Always | Permanent Orbit-Normal ($\psi = 0^\circ$) | $0^\circ/\text{s}$ | CSNO Metadata; Montenbruck et al. |
| **BeiDou-3 CAST** | `BDS-3M-CAST`, `BDS-3I`, `BDS-3SM-CAST` | $|\beta| \le 2.8^\circ\text{–}3.0^\circ$ | Continuous smoothed YS ($\beta_d$ with $d = 80{,}000$, or WHU cosine window $t_{\max} \approx 3090\text{ s}$ MEO / $5740\text{ s}$ IGSO) | $\approx 0.085\text{–}0.159^\circ/\text{s}$ | CSNO Metadata; Wang et al. (2018); Xia et al. (2019) |
| **BeiDou-3 SECM** | `BDS-3M-SECM-A`, `BDS-3M-SECM-B`, `BDS-3SM-SECM` | $|\beta| \le 3.0^\circ$ | CSNO spec clamps $\beta$ at $\pm 3^\circ$; in-orbit postponed flip when $\beta$ crosses $0^\circ$ and $\|\psi\| \le 5^\circ$ (3–5 min slew) | $\approx 0.055^\circ/\text{s}$ | CSNO Metadata; Yang et al.; Lin et al. |
| **QZSS-1 (IGSO)** | `QZS-1` (retired) | $|\beta| \le 20^\circ$ | Abrupt YS $\leftrightarrow$ ON switch at $|\beta| \approx 20^\circ$ | — | Cabinet Office `SPI-QZS1` |
| **QZSS-2 / 1R (IGSO)** | `QZS-2I`, `QZS-2A` | $|\dot{\psi}_{\text{nom}}| > 0.055^\circ/\text{s}$ ($\|\beta\| < 5^\circ$) | Continuous YS year-round; pseudo-YS at constant $\pm\omega_c$ through $\psi_1 = \pm 90^\circ$ (ON only during orbit maneuvers) | $\omega_c = 0.055^\circ/\text{s}$ | Cabinet Office `SPI-QZS2`, `SPI-QZS1R` |
| **QZSS GEO** | `QZS-2G`, `QZS-3G` | Always | Permanent Orbit-Normal ($\psi = 0^\circ$) | $0^\circ/\text{s}$ | Cabinet Office `SPI-QZS3`, `SPI-QZS6`, `SPI-QZS7` |
| **NavIC (IRNSS-1 / NVS)** | `IRS-1G`, `IRS-1I`, `IRS-2G`, `IRS-2I` | Unconfirmed publicly ($\sim 2.8^\circ\text{–}5^\circ$ modeled) | Regional target pointing toward $(83^\circ\text{E}, 5^\circ\text{N})$; YS with low-$\|\beta\|$ ON fallback (NVS-01 eclipse behavior unconfirmed) | Unconfirmed | Montenbruck et al. (2015); ISRO |

---

### 3.2 GPS Block IIR (`GPS-IIR-A`, `GPS-IIR-B`, `GPS-IIR-M`)

**References:** Bar-Sever (1996); Kouba (2009), *"A simplified yaw-attitude model for eclipsing GPS satellites"*, *GPS Solutions* 13(1):1–12; Kouba (2017) IGS `eclips.f`.

Unlike legacy GPS Block IIA (which had a $+0.5^\circ$ yaw bias, a $0.10\text{–}0.13^\circ/\text{s}$ rate limit, and blind shadow turns followed by a ~30-minute post-shadow recovery), GPS Block IIR/IIR-M satellites:
1. Have **zero nominal yaw bias** ($b = 0^\circ$).
2. Maintain attitude control through Earth shadow via onboard momentum wheels/IMU without losing yaw reference.
3. Use a single symmetric **rate-limited yaw maneuver** for **both noon turns ($\mu \approx 180^\circ$) and midnight turns ($\mu \approx 0^\circ$)** whenever $|\dot{\psi}_{\text{nom}}|$ exceeds the hardware yaw-rate limit:

$$
R_{\text{IIR}} = 0.20^\circ/\text{s}
$$

**Trigger Threshold:**
$$
|\beta| < \beta_{0,\text{IIR}} = \arctan\!\left(\frac{\dot{\mu}}{R_{\text{IIR}}}\right) = \arctan\!\left(\frac{0.00836^\circ/\text{s}}{0.20^\circ/\text{s}}\right) \approx 2.39^\circ
$$

**Maneuver Equations:**  
Let $\mu_{\text{turn}}$ be the start orbit angle where $|\dot{\psi}_{\text{nom}}(\beta, \mu_s)| = R_{\text{IIR}}$ prior to noon or midnight, or equivalently let $t_s$ be the turn entry epoch where the nominal yaw rate hits $R_{\text{IIR}}$ (in Kouba 2009, approximated near the node by $\mu_s \approx \mu_{\text{node}} - \Delta\mu_s$):

$$
\psi(t) = \psi_{\text{nom}}(t_s) + \operatorname{sign}\!\left(\dot{\psi}_{\text{nom}}(t_s)\right)\, R_{\text{IIR}}\,(t - t_s)
$$

The turn ends at $t_e > t_{\text{node}}$ when $\psi(t_e)$ catches up to and intersects $\psi_{\text{nom}}(t_e)$ (maximum duration $\le 180^\circ / 0.20^\circ/\text{s} \approx 15\text{ min}$ as $\beta \to 0^\circ$). Outside $[t_s, t_e]$, $\psi(t) = \psi_{\text{nom}}(t)$. No separate post-shadow recovery phase exists.

---

### 3.3 GPS Block IIF (`GPS-IIF`)

**References:** Dilssner (2010), *GPS Block IIF-1 antenna phase center and attitude analysis*; Kouba (2009, 2017); Kuang, Desai, & Sibois (2017), *Observed features of GPS Block IIF satellite yaw maneuvers*.

GPS Block IIF introduces asymmetric handling between **orbit noon** and **Earth shadow crossings**, plus a subtle low-$\beta$ turn-direction bias:

1. **Hardware Yaw Rate Limit:**
   $$R_{\text{IIF}} = 0.11^\circ/\text{s}$$

2. **Noon Turn ($|\beta| < \beta_{0,\text{IIF}} \approx \arctan(0.00836 / 0.11) \approx 4.35^\circ$):**
   - Rate-limited slew at $\pm R_{\text{IIF}} = \pm 0.11^\circ/\text{s}$, analogous to Block IIR:
     $$\psi(t) = \psi_{\text{nom}}(t_s) + \operatorname{sign}\!\left(\dot{\psi}_{\text{nom}}(t_s)\right)\, R_{\text{IIF}}\,(t - t_s)$$
   - **Empirical Bias Anomaly (Kuang et al., 2017):** Block IIF carries a $-0.5^\circ$ hardware yaw bias that manifests in RKPPP observations as an effective $\sim -0.7^\circ$ $\beta$-bias in noon-turn direction: for $\beta \in [-0.7^\circ, 0^\circ]$, Block IIF satellites have been observed to reverse their noon-turn rotation direction compared to the unbiased $\operatorname{sign}(\beta)$ prediction.

3. **Midnight / Shadow-Crossing Turn (Umbra/Penumbra Entry $t_s$ to Exit $t_e$):**
   - When the satellite enters Earth's shadow (umbra/penumbra half-angle $\approx 13.5^\circ$ at GPS altitude, so shadow occurs for $|\beta| \lesssim 13.5^\circ$), Block IIF does **not** slew blindly at $0.11^\circ/\text{s}$. Instead, it computes a **constant linear yaw rate tailored to the full shadow transit duration**:
     $$\dot{\psi}_{\text{shadow}} = \frac{\operatorname{wrap}_{[-\pi,\pi]}\!\left(\psi_{\text{nom}}(t_e) - \psi_{\text{nom}}(t_s)\right)}{t_e - t_s}$$
     $$\psi(t) = \psi_{\text{nom}}(t_s) + \dot{\psi}_{\text{shadow}}\,(t - t_s), \qquad t \in [t_s,\, t_e]$$
   - In deep eclipses ($\beta \approx 0^\circ$, shadow duration $\approx 50\text{–}56\text{ min}$), $|\dot{\psi}_{\text{shadow}}| \approx 0.05^\circ\text{–}0.06^\circ/\text{s} < R_{\text{IIF}}$.
   - Because $\psi(t_e) = \psi_{\text{nom}}(t_e)$ by construction, **no post-shadow catch-up maneuver is needed** upon shadow exit.

---

### 3.4 GPS Block III / IIIA (`GPS-III`, `GPS-IIIA`, `GPS-III-1`)

**References:** Montenbruck, Duan, Steigenberger, & Hugentobler (2026), *"Improved attitude modeling for GPS III satellites in the eclipse season"*, *Advances in Space Research* 77(4):4901–4908; Steigenberger et al. (IGS MGEX).

GPS III satellites eliminate sharp bang-bang yaw-rate corners in favor of **smoothed, continuous rate-limited yaw steering**:

1. **Characteristic Transition Rate:**
   $$R_{\text{III}} = 0.082^\circ/\text{s}$$
   corresponding to a rate-limited onset near $|\beta| \lesssim \arctan(0.00836 / 0.082) \approx 5.82^\circ$.
2. **Profile Characteristics (JPL quaternion analysis, Montenbruck et al., 2026):**
   - Both noon and midnight maneuvers are **symmetric** about the noon ($\mu = 180^\circ$) and midnight ($\mu = 0^\circ$) epochs.
   - Instead of holding a constant plateau rate with discontinuous acceleration, $|\dot{\psi}(t)|$ varies smoothly with a gradual ramp-up and ramp-down subject to $|\dot{\psi}(t)| \le 0.082^\circ/\text{s}$, stretching the transition over ~1 hour centered on the node.
   - **No post-shadow recovery** is required.
   - *(Note: GPS III has a very small horizontal L-band PCO of $\approx 7\text{ cm}$ vs. $\sim 40\text{ cm}$ on Block IIF, making empirical RKPPP yaw estimation challenging and making JPL attitude quaternions / analytical smoothed profiles the primary reference.)*

---

### 3.5 GLONASS (`GLO-M`, `GLO-M+`, `GLO-K1*`, `GLO-K2`)

#### 3.5.1 GLONASS-M (`GLO-M`, `GLO-M+`)

**Reference:** Dilssner et al. (2011), *"The GLONASS-M satellite yaw-attitude model"*, *Advances in Space Research* 47(2):160–171.

- **Hardware Yaw Rate Limit:**
  $$R_{\text{GLO-M}} = 0.25^\circ/\text{s} \quad (\text{empirical per-SV range } 0.24\text{–}0.26^\circ/\text{s})$$
- **Earth Shadow Cone Half-Angle (at GLONASS $a \approx 25{,}510\text{ km}$):** $\theta_0 \approx 14.2^\circ$. Shadow entry/exit orbit angle from midnight is $\mu_e = \arccos(\cos\theta_0 / \cos\beta)$ whenever $|\beta| < 14.2^\circ$.
- **Noon Turn ($|\beta| < \arctan(\dot{\mu} / R_{\text{GLO-M}}) \approx 2.0^\circ$):**
  - **Symmetric / centered** about orbit noon ($\mu = 180^\circ$), slewing at constant $\pm R_{\text{GLO-M}} = \pm 0.25^\circ/\text{s}$ and passing through $\psi = \pm 90^\circ$ at exact noon (duration $\le 180^\circ / 0.25^\circ/\text{s} = 720\text{ s} = 12\text{ min}$).
- **Midnight Turn / Shadow Crossing ($|\beta| < 14.2^\circ$):**
  - **Triggered immediately at shadow entry** ($t_s$, where $\mu = -\mu_e$): the spacecraft slews at maximum hardware rate $\pm R_{\text{GLO-M}} = \pm 0.25^\circ/\text{s}$ (direction determined by $\operatorname{sign}(\dot{\psi}_{\text{nom}}(t_s))$) **until $\psi(t)$ reaches the nominal yaw angle expected at shadow exit**, $\psi_{\text{nom}}(t_e)$:
    $$t_{\text{reach}} = t_s + \frac{|\Delta\psi|}{R_{\text{GLO-M}}}, \qquad \Delta\psi = \operatorname{wrap}_{[-\pi,\pi]}\!\left(\psi_{\text{nom}}(t_e) - \psi_{\text{nom}}(t_s)\right)$$
  - For $t \in [t_{\text{reach}}, t_e]$ (if $t_{\text{reach}} < t_e$), the satellite **holds $\psi(t) = \psi_{\text{nom}}(t_e)$ constant** until emerging from shadow at $t_e$. (In deep eclipse $|\beta| \lesssim 2^\circ$, the $180^\circ$ slew finishes in ~12 min while the shadow lasts ~55 min, so the satellite holds constant yaw for ~43 min until shadow exit.)

#### 3.5.2 GLONASS-K1 (`GLO-K1`, `GLO-K1+`, `GLO-K1A`, `GLO-K1B`) and GLONASS-K2 (`GLO-K2`)

**References:** Dilssner & Springer (IGS); Steigenberger, Montenbruck, & Hauschild (2024), DLR/GSOC GLONASS-K1/K2 attitude & CDMA analysis.

- **Key Architectural Change from GLONASS-M:** Both noon and midnight turns on GLONASS-K1 and GLONASS-K2 are **symmetric and centered around exact orbit noon ($\mu = 180^\circ$) and orbit midnight ($\mu = 0^\circ$)**—they do **not** trigger asymmetrically at shadow entry.
- **Profile Shape & Rate:** For $|\beta| \lesssim 2.0^\circ$, the maneuver consists of a linear ramp-up in $|\dot{\psi}|$, a constant-rate phase at:
  $$R_{\text{GLO-K}} = 0.24987^\circ/\text{s} \approx 0.25^\circ/\text{s}$$
  and a symmetric linear ramp-down back to nominal yaw steering.
- **GLONASS-K2 Specifics & Data Availability:** First launched in August 2023; Steigenberger et al. (2024) showed $\sim 1^\circ\text{–}2^\circ$ agreement with the theoretical symmetric rate-limited model using triple-frequency carrier-phase observations. Unlike older FDMA-only satellites, GLONASS-K2 (and modernized K1) **broadcast explicit attitude/maneuver parameters in L1 and L3 CDMA navigation messages** (supported in RINEX 4.02). Detailed manufacturer-internal hardware specifications for K2 remain sparse in open literature compared to GLONASS-M, so the symmetric $0.24987^\circ/\text{s}$ centered law is the recommended model when broadcast CDMA attitude records are absent.

---

### 3.6 Galileo IOV (`GAL-1`) and FOC (`GAL-2`)

**References:** European GNSS Service Centre (GSC) / EUSPA, *Galileo Satellite Metadata* (`gsc-europa.eu`); Montenbruck et al. (2015).

*(Note: GSC defines the Galileo mechanical frame with $+X_{\text{mech}}$ facing deep space and $\eta$ from noon; below, $S_{ox}, S_{oy}, S_{oz}$ follow the GSC orbital Sun vector convention $\vec{S}_o = (-\sin\eta\cos\beta,\; -\sin\beta,\; -\cos\eta\cos\beta)^T$, equivalent to $(-s_x,\; s_y,\; -s_z)^T$ in our midnight-referenced $\mathcal{O}$ frame, and $\psi_{\text{IGS}} = \psi_{\text{GSC}} + 180^\circ$.)*

#### 3.6.1 Galileo IOV (`GAL-1`) — Auxiliary Sun Reference Vector Law

When the Sun approaches collinearity with the satellite nadir/anti-nadir axis, defined by the rectangular box:

$$
|S_{ox}| < \sin\beta_x \quad (\beta_x = 15.0^\circ) \qquad \text{AND} \qquad |S_{oy}| < \sin\beta_y \quad (\beta_y = 2.0^\circ)
$$

the true Sun unit vector $\vec{S}_o = (S_{ox}, S_{oy}, S_{oz})^T$ is replaced by the **auxiliary Sun reference vector** $\vec{S}_H = (S_{Hx}, S_{Hy}, S_{Hz})^T$:

$$
S_{Hx} = S_{ox}
$$
$$
S_{Hy} = \frac{1}{2}\left(\Gamma \sin\beta_y + S_{oy}\right) + \frac{1}{2}\left(\Gamma \sin\beta_y - S_{oy}\right)\cos\!\left(\frac{\pi\,|S_{ox}|}{\sin\beta_x}\right)
$$
$$
S_{Hz} = \sqrt{1 - S_{Hx}^2 - S_{Hy}^2}\,\operatorname{sign}(S_{oz})
$$

where $\Gamma = \operatorname{sign}(S_{oy})$ evaluated at entry into the auxiliary region (if $S_{oy} = 0$, $\Gamma = +1$). Substituting $(S_{Hx}, S_{Hy})$ into the nominal yaw equation guarantees $|S_{Hy}| \ge \sin 2^\circ$ at $S_{ox} = 0$, smoothly capping $|\dot{\psi}| < 0.2^\circ/\text{s}$. In our $\mathcal{B}$ frame (`+X` toward Sun):

$$
\psi_{\text{IOV}} = \operatorname{atan2}(S_{Hy},\; -S_{Hx})
$$

#### 3.6.2 Galileo FOC (`GAL-2`) — GSC Modified Yaw Steering Law

For Galileo FOC, GSC metadata replaces the auxiliary-vector law with a **time-domain cosine transition**:

- **Activation Condition:** Entered when **all three** hold:
  1. $|\beta| < 4.1^\circ$
  2. Current collinearity angle $\epsilon < 10.0^\circ$ (where $\epsilon = \arccos(|\cos\beta\cos\mu|)$)
  3. Previous epoch's collinearity angle $\epsilon_{\text{prev}} > 10.0^\circ$ (switch-over trigger epoch $t_{\text{init}}$, with $\psi_{\text{init}} = \psi_{\text{nom}}(t_{\text{init}})$).
- **Modified Yaw Law:** For $t_{\text{mod}} = t - t_{\text{init}} \in [0,\; T_{\text{half}}]$ where $T_{\text{period}} = 5656\text{ s}$ ($T_{\text{half}} = 2828\text{ s} \approx 47.1\text{ min}$):

$$
\psi_{\text{FOC}}(t_{\text{mod}}) = 90^\circ \cdot \operatorname{sign}(\psi_{\text{init}}) + \left(\psi_{\text{init}} - 90^\circ \cdot \operatorname{sign}(\psi_{\text{init}})\right)\cos\!\left(\frac{2\pi}{5656\text{ s}}\,t_{\text{mod}}\right)
$$

*(Note: Because the GSC definition $\psi_{\text{GSC}} \in [-180^\circ, 180^\circ]$ is shifted by $180^\circ$ from $\psi_{\text{IGS}}$, $\pm 90^\circ$ points in the same $+\hat{\mathbf{h}}$ / $-\hat{\mathbf{h}}$ cross-track direction, and $\operatorname{sign}(\psi_{\text{init}})$ in $\psi_{\text{IGS}}$ keeps the same midpoint $\pm 90^\circ$: check at $t_{\text{mod}} = 0 \implies \psi_{\text{init}}$; $t_{\text{mod}} = 1414\text{ s} \implies \pm 90^\circ$; $t_{\text{mod}} = 2828\text{ s} \implies \pm 180^\circ - \psi_{\text{init}}$.)*

---

### 3.7 BeiDou-2 & BeiDou-3 (`BDS-2*`, `BDS-3*`)

**References:** CSNO Official BeiDou Satellite Metadata; Guo et al. (2016); Zhao et al. (2018), *GPS Solutions* 22:4; Wang et al. (2018), *"Yaw attitude modeling for BeiDou I06 and BeiDou-3 satellites"*, *GPS Solutions* 22:117; Xia et al. (2019); Yang et al. / Lin et al. (SECM analysis).

#### 3.7.1 GEO Satellites (`BDS-2G`, `BDS-3G`)
- **Permanent Orbit-Normal (ON) mode** at all times: $\psi \equiv 0^\circ$, $\dot{\psi} \equiv 0^\circ/\text{s}$.

#### 3.7.2 BeiDou-2 IGSO & MEO (`BDS-2I`, `BDS-2M`)
- **Classical Baseline:** Abrupt switch between **Yaw Steering (YS)** and **Orbit Normal (ON)** at $|\beta| = 4.0^\circ$:
  $$
  \psi(t) = \begin{cases} \psi_{\text{nom}}(\beta, \mu) & |\beta| > 4.0^\circ \\ 0^\circ \text{ (ON)} & |\beta| \le 4.0^\circ \end{cases}
  $$
  (Physical transitions occur near $\psi_{\text{nom}} \approx 0^\circ$ or $180^\circ$ at quadratures to minimize slewing transients.)
- **2017–2018 Firmware Upgrade:** Beginning with MEO C14 in September 2017 and subsequently observed on several BDS-2 IGSO/MEO satellites (e.g., C06, C13, C14, C16), on-orbit firmware updates disabled the low-$|\beta|$ ON switch and migrated those vehicles to **Continuous Yaw Steering (CYS)** using smoothed midnight/noon turns to eliminate POD/clock degradation during eclipses.

#### 3.7.3 BeiDou-3 CAST (`BDS-3M-CAST`, `BDS-3I`, `BDS-3SM-CAST`)
CAST-built MEO and IGSO satellites (plus experimental `BDS-3SM-CAST`) execute **Continuous Yaw Steering (CYS)** down to $\beta = 0^\circ$. Two equivalent analytical formulations appear in IGS/CSNO literature:

1. **Modified-$\beta$ Damping Model (ESOC / Xia et al., 2019):**
   $$\psi_{\text{CAST}} = \operatorname{atan2}(-\tan\beta_d,\; \sin\mu)$$
   $$\beta_d = \beta + f \cdot \left(\operatorname{sign}(\beta)\,\beta_0 - \beta\right), \qquad f = \begin{cases} \dfrac{1}{1 + d \sin^4\mu} & |\beta| \le \beta_0 \\ 0 & |\beta| > \beta_0 \end{cases}$$
   with $\beta_0 = 2.8^\circ$ (MEO) to $3.0^\circ$ (CSNO nominal) and damping constant $d = 80{,}000$ (smoothly keeping $|\beta_d| = \beta_0$ right at noon/midnight $\mu = 0^\circ, 180^\circ$ while returning $\beta_d \to \beta$ rapidly away from the nodes; peak yaw rates $\approx 0.159^\circ/\text{s}$ MEO / $0.085^\circ/\text{s}$ IGSO).

2. **WHU Cosine-Window Model (Wang et al., 2018):**
   Triggered when $|\beta| \le 3.0^\circ$ at orbit-angle boundary $\mu_s$ near midnight/noon (e.g., $\mu_s \approx -6^\circ$ or $174^\circ$):
   $$\psi_{\text{WHU}}(t) = 90^\circ \cdot \operatorname{sign}(\psi_s) + \left(\psi_s - 90^\circ \cdot \operatorname{sign}(\psi_s)\right)\cos\!\left(\frac{2\pi}{t_{\max}}(t - t_s)\right)$$
   with $\psi_s = \psi_{\text{nom}}(t_s)$ and characteristic period $t_{\max} \approx 3090\text{ s}$ (MEO) or $t_{\max} \approx 5740\text{ s}$ (IGSO).

#### 3.7.4 BeiDou-3 SECM (`BDS-3M-SECM-A`, `BDS-3M-SECM-B`, `BDS-3SM-SECM`)
- **CSNO Published Specification:** Clamps the effective $\beta$ at $\pm\beta_0$ ($\beta_0 = 3.0^\circ$) whenever $|\beta| \le 3.0^\circ$:
  $$
  \psi_{\text{SECM,CSNO}} = \begin{cases}
  \operatorname{atan2}(-\tan\beta,\; \sin\mu) & |\beta| > 3.0^\circ \\
  \operatorname{atan2}(-\tan(+3.0^\circ),\; \sin\mu) & 0 \le \beta \le 3.0^\circ \\
  \operatorname{atan2}(-\tan(-3.0^\circ),\; \sin\mu) & -3.0^\circ \le \beta < 0
  \end{cases}
  $$
- **Observed In-Orbit Behavior (Postponed Flip Anomaly):** ISL and RKPPP studies (Yang et al.; Lin et al.) show SECM MEOs do not flip immediately at $\beta = 0^\circ$ per the static CSNO rule; instead, the attitude flip is **postponed** until $\beta$ crosses $0^\circ$ **and** the instantaneous yaw angle drops within $|\psi| \le 5^\circ$, completing the transition over ~3–5 minutes at a nearly constant rate of $\approx 0.055^\circ/\text{s}$.
- **Experimental `BDS-3S*` (`BDS-3SI-CAST`, `BDS-3SI-SECM`, `BDS-3S`):** Pre-operational testbeds validating continuous YS ($\beta_0 \approx 3^\circ$) prior to operational BDS-3 deployment.

---

### 3.8 QZSS (`QZS-1`, `QZS-2I`, `QZS-2A`, `QZS-2G`, `QZS-3G`)

**References:** Cabinet Office of Japan / JAXA *Satellite Property Information*: `SPI-QZS1_A`, `SPI-QZS2_C`, `SPI-QZS3_F`, `SPI-QZS4_C`, `SPI-QZS1R`.

1. **QZS-1 (`QZS-1`, IGSO, retired):**
   - **YS $\leftrightarrow$ ON switch at $|\beta| \approx 20^\circ$:**
     - $|\beta| > 20^\circ$: Nominal Yaw Steering (YS).
     - $|\beta| \le 20^\circ$: Orbit-Normal (ON) mode ($\psi = 0^\circ$ or $180^\circ$ depending on ON hemisphere convention; flip maneuvers occur at $\beta$ sign transitions / ON entry).

2. **QZS-2, QZS-4 (`QZS-2I`) and QZS-1R (`QZS-2A`):**
   - **Continuous Yaw Steering year-round** (ON mode is invoked *only* during active orbit-control maneuvers, not for low $|\beta|$).
   - **Pseudo-Yaw-Steering near Noon/Midnight ($|\beta| \lesssim 5^\circ$):**  
     When the required nominal yaw rate at midnight or noon ($t_1$) exceeds the DS2000 reaction-wheel rate cap:
     $$\omega_c = 0.055^\circ/\text{s}$$
     the spacecraft executes a constant-rate pseudo-yaw-steering slew passing through $\psi_1 = \operatorname{sign}(\beta)\cdot 90^\circ$ at the node $t_1$:
     $$\psi(t) = \psi_{\text{nom}}(t_s) + R_{\text{dir}} \cdot \omega_c\,(t - t_s), \qquad R_{\text{dir}} = \operatorname{sign}(\psi_1 - \psi_{\text{nom}}(t_s)) \in \{-1, +1\}$$
     *(Note: In `SPI-QZS2`/`SPI-QZS1R`, $+X$ is anti-Sun, so their published formula reads $\psi = \operatorname{atan2}(\tan\beta, -\sin\mu)$ and $\psi_1 = +90^\circ$ for $\beta > 0$; in our $+X$-Sun frame, $\psi_1 = -90^\circ$ for $\beta > 0$ and $+90^\circ$ for $\beta < 0$ at midnight, reversing at noon. For $|\beta| < 0.03^\circ$, turn direction can be unpredictable and is reported via Operational History Information `OHI-QZSS`.)*

3. **QZS-3, QZS-6, QZS-7 (`QZS-2G`, `QZS-3G`, GEO):**
   - **Permanent Orbit-Normal (ON) mode** at all times ($\psi = 0^\circ$).

---

### 3.9 NavIC / IRNSS (`IRS-1G`, `IRS-1I`, `IRS-2G`, `IRS-2I`)

**References:** Montenbruck, Steigenberger, & Riley (2015), *"IRNSS orbit determination and broadcast ephemeris assessment"*; Steigenberger & Montenbruck multi-GNSS metadata; ISRO public disclosures.

1. **Unique Regional Target Pointing (All Active NavIC SVs):**
   - Unlike GPS/GLONASS/Galileo/BeiDou/QZSS whose $+\mathbf{Z}_B$ points to geocentric nadir, NavIC GEO (`IRS-1G`, `IRS-2G`) and IGSO (`IRS-1I`, `IRS-2I`) satellites point their navigation antenna boresight ($+\mathbf{Z}_B$) toward a **fixed Earth-surface target in the Indian primary service area** at $(\phi_0 = +5^\circ\text{N},\; \lambda_0 = +83^\circ\text{E})$ on WGS84.
   - Let $\mathbf{r}_{\text{tgt}}$ be the ECEF/ECI position of $(5^\circ\text{N}, 83^\circ\text{E}, 0\text{ m})$. Then the true boresight is:
     $$\hat{\mathbf{Z}}_B = \frac{\mathbf{r}_{\text{tgt}} - \mathbf{r}}{\|\mathbf{r}_{\text{tgt}} - \mathbf{r}\|}$$
     introducing continuous few-degree pitch/roll/yaw offsets relative to pure geocentric nadir $-\hat{\mathbf{r}}$.
2. **IRNSS-1 (`IRS-1G`, `IRS-1I`, I-1K bus):**
   - Operates in Yaw Steering (with target-pointing $\hat{\mathbf{Z}}_B$) to track the Sun, switching to Orbit-Normal (ON) at small $|\beta|$ to avoid yaw-rate saturation.
   - **Verification Status:** ISRO does **not** publish a formal public attitude-law specification equivalent to GSC or QZSS SPI. Multi-GNSS POD literature (Montenbruck et al., 2015) uses biased YS / ON approximations (modeled switching thresholds around $|\beta| \approx 2.8^\circ\text{–}5^\circ$ in empirical analyses remain unconfirmed by an official ISRO ICD).
3. **NVS-01 / NVS-02 (`IRS-2G`, `IRS-2I`, I-2K bus):**
   - **Verification Status:** Retains regional target-pointing geometry over India. **Unconfirmed:** ISRO has not published official eclipse-season yaw-rate limits, smoothing laws, or $|\beta|$ ON-switching thresholds for NVS-01 (`IRS-2G`) or NVS-02 (`IRS-2I`). Until IGS/MGEX RKPPP studies publish empirical attitude profiles for `IRS-2*`, implementers should model them with target-pointed YS and an optional configurable ON fallback at low $|\beta|$ (defaulting to continuous/clamped YS or ON switch flagged as `ESTIMATED`).

---

## 4. Code Implementation Proposal for GNSS Studio

This section specifies a clean, stateless-first (with optional stateful/window support) attitude module designed to integrate directly with [`IgsMetadata`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/gnss_predict/igs_meta.py#L47-L84), [`satellites_czml`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/gnss_predict/czml.py#L71-L99), [`bodyFrame`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/web/src/cesium/sensorGeometry.ts#L79-L90), and [`models/catalog.json`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/catalog.json).

### 4.1 Recommended Module & Data Types

**Python backend module:** `gnss_predict/attitude.py` (mirrors cleanly to `web/src/cesium/attitude.ts` if evaluated client-side per frame).

```python
from enum import Enum
from dataclasses import dataclass

class AttitudeLaw(str, Enum):
    NOMINAL_YS = "nominal_ys"          # Fallback for unknown blocks
    ORBIT_NORMAL = "orbit_normal"      # BDS-2G, BDS-3G, QZS-2G, QZS-3G
    GPS_IIR = "gps_iir"                # R = 0.20 deg/s symmetric noon/midnight
    GPS_IIF = "gps_iif"                # R = 0.11 deg/s noon (-0.7 deg beta bias), linear shadow
    GPS_III = "gps_iii"                # Smoothed R = 0.082 deg/s symmetric
    GLONASS_M = "glonass_m"            # R = 0.25 deg/s noon, shadow-entry slew + hold
    GLONASS_K = "glonass_k"            # R = 0.24987 deg/s symmetric centered noon/midnight
    GALILEO_IOV = "galileo_iov"        # Auxiliary Sun vector (15 deg, 2 deg)
    GALILEO_FOC = "galileo_foc"        # Cosine law (|beta|<4.1 deg, eps<10 deg, T=5656 s)
    BDS2_YS_ON = "bds2_ys_on"          # YS/ON switch at |beta| = 4.0 deg (or CYS override)
    BDS3_CAST = "bds3_cast"            # Beta-damped CYS (beta0 = 2.8-3.0 deg, d = 80000)
    BDS3_SECM = "bds3_secm"            # Beta-clamped (beta0 = 3.0 deg) / postponed flip
    QZSS1_YS_ON = "qzss1_ys_on"        # YS/ON switch at |beta| = 20.0 deg
    QZSS2_PSEUDO_YS = "qzss2_pseudo_ys"# Continuous YS + pseudo-YS (omega_c = 0.055 deg/s)
    NAVIC_TARGETED = "navic_targeted"  # Target (5N, 83E) + YS/ON fallback (est.)

class AttitudeMode(str, Enum):
    YAW_STEERING = "YS"
    ORBIT_NORMAL = "ON"
    NOON_TURN = "NOON_TURN"
    MIDNIGHT_TURN = "MIDNIGHT_TURN"
    SHADOW_CROSSING = "SHADOW"
    SMOOTHED_TURN = "SMOOTHED_TURN"

@dataclass(frozen=True)
class AttitudeState:
    yaw_rad: float                     # psi in [-pi, pi], rotation about +Z_ON
    yaw_rate_rad_s: float              # d(psi)/dt [rad/s]
    solar_wing_pitch_rad: float        # theta_SA about +Y_B for +X_B cell normal [rad]
    beta_rad: float                    # Sun elevation above orbit plane [-pi/2, pi/2]
    mu_rad: float                      # Orbit angle from midnight (-pi, pi]
    mode: AttitudeMode                 # Active kinematic regime
    in_shadow: bool                    # True if satellite in Earth umbra/penumbra
    quaternion_eci_to_body: tuple[float, float, float, float]  # (x, y, z, w)
    boresight_eci: tuple[float, float, float]                  # +Z_B unit vector
    is_estimated: bool = False         # True for unconfirmed blocks (e.g. NVS-01, GLO-K2)
```

### 4.2 Recommended Function Signatures

1. **`law_for_block(block: str, prn: str | None = None) -> AttitudeLaw`**
   - Maps IGS `SATELLITE/IDENTIFIER` block strings (from [`igs_meta.py`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/gnss_predict/igs_meta.py)) to `AttitudeLaw`:
     - `GPS-IIR-A`, `GPS-IIR-B`, `GPS-IIR-M` $\to$ `GPS_IIR`
     - `GPS-IIF` $\to$ `GPS_IIF`
     - `GPS-III`, `GPS-IIIA`, `GPS-III-1` $\to$ `GPS_III`
     - `GLO-M`, `GLO-M+` $\to$ `GLONASS_M`
     - `GLO-K1`, `GLO-K1+`, `GLO-K1A`, `GLO-K1B`, `GLO-K2` $\to$ `GLONASS_K`
     - `GAL-1` $\to$ `GALILEO_IOV`
     - `GAL-2` $\to$ `GALILEO_FOC`
     - `BDS-2G`, `BDS-3G`, `QZS-2G`, `QZS-3G` $\to$ `ORBIT_NORMAL`
     - `BDS-2I`, `BDS-2M` $\to$ `BDS2_YS_ON` (with optional PRN override list for post-2017 upgraded SVs using CYS)
     - `BDS-3M-CAST`, `BDS-3I`, `BDS-3SM-CAST`, `BDS-3SI-CAST` $\to$ `BDS3_CAST`
     - `BDS-3M-SECM-A`, `BDS-3M-SECM-B`, `BDS-3SM-SECM`, `BDS-3SI-SECM` $\to$ `BDS3_SECM`
     - `QZS-1` $\to$ `QZSS1_YS_ON`
     - `QZS-2I`, `QZS-2A` $\to$ `QZSS2_PSEUDO_YS`
     - `IRS-1G`, `IRS-1I`, `IRS-2G`, `IRS-2I` $\to$ `NAVIC_TARGETED`
     - Unknown / retired (`GPS-I`, `GPS-II`, `GPS-IIA`, `GAL-0A`, `GAL-0B`, `GLO`, `BDS-3S`) $\to$ `NOMINAL_YS` (or `GPS_IIA` if legacy modeling added).

2. **`sun_position_eci(epoch_utc: datetime) -> tuple[float, float, float]`**
   - Low-precision (~$0.01^\circ$) analytical solar ephemeris (Vallado / Astronomical Almanac) returning unit vector $\hat{\mathbf{s}}$ in ECI (J2000/ICRF) in meters or unit vector; accurate to $< 0.02^\circ$ for attitude visualization and eclipse geometry without external ephemeris downloads.

3. **`orbit_sun_geometry(r_eci_m, v_eci_m_s, sun_hat_eci) -> tuple[float, float, float, bool]`**
   - Computes $(\beta_{\text{rad}}, \mu_{\text{rad}}, \dot{\mu}_{\text{rad/s}}, \text{in\_shadow})$ plus the ON basis $(\hat{\mathbf{x}}_{\text{ON}}, \hat{\mathbf{y}}_{\text{ON}}, \hat{\mathbf{z}}_{\text{ON}})$.
   - Conical Earth shadow test (cylindrical or umbra/penumbra):
     `in_shadow = (dot(r_eci, sun_hat) < 0) and (norm(cross(r_eci, sun_hat)) < R_EARTH_M)` (for umbra/cylindrical shadow entry $t_s, t_e$).

4. **`compute_attitude(block: str, r_eci_m: Vec3, v_eci_m_s: Vec3, epoch_utc: datetime, *, prn: str | None = None, turn_state: TurnTracker | None = None) -> AttitudeState`**
   - Single entry point returning `AttitudeState` for one epoch.
   - `turn_state` is optional: required only for exact time-domain stateful laws (`GALILEO_FOC` $t_{\text{mod}}$, `GPS_IIF` shadow transit $[t_s, t_e]$, `GLONASS_M` shadow hold $[t_{\text{reach}}, t_e]$, `BDS3_SECM` postponed-flip hysteresis). When `turn_state is None` (single-epoch stateless calls), provide an analytical circular-orbit estimate of $t_s, t_e$ from $(\beta, \mu, \dot{\mu})$:
     - Shadow half-angle $\theta_0 = \arcsin(R_\oplus / \|\mathbf{r}\|)$ and $\mu_e = \arccos(\cos\theta_0 / \cos\beta)$ when $|\beta| < \theta_0$, giving $t - t_s \approx (\mu + \mu_e) / \dot{\mu}$ and $t_e - t_s \approx 2\mu_e / \dot{\mu}$!
     - Centered noon/midnight turn half-arc estimated analytically by solving $|\dot{\psi}_{\text{nom}}(\beta, \mu_s)| = R$ for $\mu_s$.

5. **`model_wing_pitch_for_glb(state: AttitudeState, model_id: str) -> float`**
   - Converts `state.solar_wing_pitch_rad` into the glTF node rotation angle matching [`models/catalog.json`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/catalog.json):
     - If the Cesium viewer applies the `180°` Z-axis body-to-model alignment (`X_model = -X_B, Y_model = -Y_B`), then the wing node rotation about local `Y_model` (glTF `-Z`) is `-state.solar_wing_pitch_rad` (`galileo-foc` uses node names `solar_wing_+Y` / `solar_wing_-Y`, all others `wing+Y` / `wing-Y`).
     - If the viewer does **not** rotate the bus by `180°` about Z (so `X_model = +X_B`), then add `+math.pi` to `solar_wing_pitch_rad` so `-X_model` cells face `+X_B`.

### 4.3 Edge-Case Handling Checklist

1. **Exact Collinearity Singularity ($\beta = 0^\circ$ and $\mu \in \{0^\circ, \pm 180^\circ\}$):**
   - `atan2(0.0, 0.0)` returns `0.0` in IEEE-754, which would cause an instantaneous $90^\circ$ jump! Guard all `NOMINAL_YS` calls with `if abs(s_x) < 1e-12 and abs(s_y) < 1e-12`: fall back to `0.0` (or previous epoch's yaw) and rely on the block's turn law to steer smoothly through $\pm 90^\circ$.
   - Clamp $|\beta|$ away from $\pm 90^\circ$ ($\cos\beta < 10^{-9}$) when computing $\mu = \operatorname{atan2}(s_x, s_z)$.
2. **$\pm 180^\circ$ Angle Wrapping in Linear Slews & CZML Interpolation:**
   - Always unwrap $\Delta\psi = \operatorname{wrap}_{[-\pi,\pi]}(\psi_{\text{end}} - \psi_{\text{start}})$ before interpolating `GPS_IIF` shadow or `GLONASS_M` target yaw; never interpolate wrapped angles across $\pm\pi$.
   - Output **unit quaternions** `(x, y, z, w)` in CZML `orientation` packets (SLERP-interpolated by CesiumJS) rather than Euler angles so $\pm 180^\circ$ wrap-around never produces visual spinning artifacts.
3. **$\beta \approx 0^\circ$ Sign Flip Hysteresis (`GPS_IIF`, `QZSS2_PSEUDO_YS`, `BDS3_SECM`):**
   - When $|\beta| < 0.05^\circ$, noise in analytical solar ephemerides can flip $\operatorname{sign}(\beta)$ mid-maneuver. Latch $\operatorname{sign}(\beta)$ at maneuver entry $t_s$ throughout the entire turn $[t_s, t_e]$.
   - For `GPS_IIF`, apply the Kuang et al. (2017) effective $\beta$ shift $\beta_{\text{eff}} = \beta + 0.7^\circ$ (or configurable bias) when selecting noon-turn direction near $\beta \in [-0.7^\circ, 0^\circ]$.
4. **NavIC Target-Pointing Frame Construction:**
   - Compute $\hat{\mathbf{Z}}_B = \operatorname{unit}(\mathbf{r}_{\text{tgt,ECI}}(t) - \mathbf{r}_{\text{ECI}})$ first, then project $\hat{\mathbf{s}}$ and $\hat{\mathbf{h}}$ orthogonal to $\hat{\mathbf{Z}}_B$ before evaluating yaw/ON orientation so the boresight stays locked on $(5^\circ\text{N}, 83^\circ\text{E})$ without distorting orthogonality.
5. **Orbit-Normal vs. `sensorGeometry.ts` Alignment:**
   - [`bodyFrame`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/web/src/cesium/sensorGeometry.ts#L79-L90) in [`sensorGeometry.ts`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/web/src/cesium/sensorGeometry.ts) defines $+\mathbf{Z} = -\hat{\mathbf{r}}$, $+\mathbf{X} = \hat{\mathbf{v}}_\perp$, $+\mathbf{Y} = \hat{\mathbf{Z}} \times \hat{\mathbf{X}} = -\hat{\mathbf{h}}$, which is **identical** to $\mathcal{O}$ ($\psi = 0^\circ$ ON mode). Applying `R_z(yaw_rad)` directly to `bodyFrame(pos, velEcef)` smoothly extends existing 2D/3D sensor footprint geometry to full GNSS yaw-steering without changing the nadir boresight.

---

## 5. สรุปภาษาไทย (Thai Summary)

เอกสารฉบับนี้รวบรวมกฎการวางตัวของดาวเทียม GNSS (Attitude Laws) สำหรับทุกกลุ่มดาวเทียมและบล็อกที่ปรากฏใน `igs_satellite_metadata.snx` และ [`models/catalog.json`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/catalog.json) โดยอ้างอิงกรอบตัวดาวเทียมของโปรเจกต์ (**$+Z$ ชี้ลงโลก/nadir**, **$+Y$ เป็นแกนหมุนแผงโซลาร์**, **$+X$ ทำให้เป็นระบบมือขวาโดยมีดวงอาทิตย์อยู่ฝั่ง $+X$** ภายใต้ Nominal Yaw Steering):

1. **โหมดพื้นฐาน (Nominal YS & Orbit-Normal):**
   - **Nominal YS:** $\psi_{\text{nom}} = \operatorname{atan2}(-\tan\beta, \sin\mu)$ โดยที่ $\beta$ คือมุมสูงของดวงอาทิตย์เหนือระนาบวงโคจร และ $\mu$ คือมุมวงโคจรนับจากจุดเที่ยงคืน (midnight) แต่เมื่อ $|\beta| \to 0^\circ$ อัตราหมุน $\dot{\psi}_{\text{nom}}$ จะเข้าใกล้อนันต์ที่จุดเที่ยงวัน/เที่ยงคืน จึงต้องมีกฎเฉพาะของแต่ละบล็อก
   - **Orbit-Normal (ON):** $\psi = 0^\circ$ แกน $+Y_B$ ตั้งฉากระนาบวงโคจร ($-\hat{\mathbf{h}}$) แกน $+X_B$ ชี้ตามทิศเคลื่อนที่

2. **ค่าคงที่และเกณฑ์สำคัญรายกลุ่มดาวเทียม:**
   - **GPS IIR (`GPS-IIR-A/B/M`):** จำกัดอัตราหันเห $R = 0.20^\circ/\text{s}$ ($|\beta| \lesssim 2.39^\circ$) ทั้ง noon และ midnight turn แบบสมมาตร ไม่มี yaw bias (Kouba 2009)
   - **GPS IIF (`GPS-IIF`):** Noon turn จำกัดอัตรา $R = 0.11^\circ/\text{s}$ ($|\beta| \lesssim 4.35^\circ$, มีความเบี่ยงเบนทิศหันเหช่วง $\beta \in [-0.7^\circ, 0^\circ]$ จาก yaw bias $-0.5^\circ$); ช่วงเข้าเงาโลก (midnight/shadow) หมุนด้วยอัตราคงที่เชิงเส้นตลอดระยะเวลาเงา $\dot{\psi}_{\text{shadow}} = \Delta\psi / (t_e - t_s) \approx 0.05\text{–}0.06^\circ/\text{s}$ (Kuang et al. 2017; Kouba 2017)
   - **GPS III (`GPS-III/IIIA`):** ใช้ smoothed rate-limited YS แบบสมมาตร จำกัดอัตราที่ $0.082^\circ/\text{s}$ ($|\beta| \lesssim 5.82^\circ$) ใช้เวลาหมุนราว 1 ชั่วโมง (Montenbruck et al. 2026)
   - **GLONASS-M (`GLO-M/M+`):** $R = 0.25^\circ/\text{s}$; Noon turn สมมาตร ($|\beta| \lesssim 2.0^\circ$, สูงสุด ~12 นาที) ส่วน Midnight turn เริ่มหมุนทันทีเมื่อเข้าเงาโลก ($|\beta| < 14.2^\circ$) ด้วยอัตรา $0.25^\circ/\text{s}$ จนถึงมุม $\psi_{\text{nom}}(t_e)$ แล้วค้างมุมไว้จนพ้นเงา (Dilssner et al. 2011)
   - **GLONASS-K1 / K2:** ใช้การหมุนแบบสมมาตรกึ่งกลางที่ noon และ midnight ทั้งคู่ ด้วยอัตรา $0.24987^\circ/\text{s}$ ($\approx 0.25^\circ/\text{s}$, ramp-up/constant/ramp-down); รุ่น K2 ส่งค่าพารามิเตอร์การหมุนผ่านข้อความนำทาง CDMA L1/L3 ด้วย (Steigenberger et al. 2024)
   - **Galileo IOV (`GAL-1`) & FOC (`GAL-2`):** ตามเอกสาร GSC อย่างเป็นทางการ IOV ใช้เวกเตอร์ดวงอาทิตย์เสริม $\vec{S}_H$ เมื่อ $|S_{ox}| < \sin 15^\circ$ และ $|S_{oy}| < \sin 2^\circ$; ส่วน FOC ใช้สูตรโคไซน์ตามเวลา $\psi_{\text{mod}}(t_{\text{mod}})$ คาบ $5656\text{ s}$ (ครึ่งรอบ $2828\text{ s}$) เมื่อ $|\beta| < 4.1^\circ$ และมุม $\epsilon$ ลดต่ำกว่า $10.0^\circ$
   - **BeiDou-2 / BeiDou-3:** ดาวเทียม GEO (`BDS-2G`, `BDS-3G`) อยู่ในโหมด ON ถาวร; BDS-2 IGSO/MEO ดั้งเดิมสลับ YS $\leftrightarrow$ ON ที่ $|\beta| = 4^\circ$ (แต่หลายดวงอัปเกรดเฟิร์มแวร์ปี 2017–2018 เป็น CYS); BDS-3 CAST ใช้ CYS แบบนุ่มนวล ($\beta_0 = 2.8^\circ\text{–}3.0^\circ$, $d = 80{,}000$ หรือหน้าต่างโคไซน์ $t_{\max} \approx 3090\text{ s}$ MEO / $5740\text{ s}$ IGSO); BDS-3 SECM ตามสเปก CSNO ล็อก $|\beta| \ge 3^\circ$ แต่บนวงโคจรจริงหน่วงการพลิกตัวจน $\beta$ ข้าม $0^\circ$ และ $|\psi| \le 5^\circ$ (หมุน 3–5 นาทีที่ $\approx 0.055^\circ/\text{s}$)
   - **QZSS:** QZS-1 (ปลดระวางแล้ว) สลับ YS $\leftrightarrow$ ON ที่ $|\beta| \approx 20^\circ$; QZS-2/4 (`QZS-2I`) และ QZS-1R (`QZS-2A`) ใช้ YS ต่อเนื่องตลอดปีร่วมกับ pseudo-YS ที่อัตรา $\omega_c = 0.055^\circ/\text{s}$ เมื่อ $|\beta| < 5^\circ$ (ใช้ ON เฉพาะตอนปรับวงโคจร); QZS-3/6/7 (GEO) ใช้ ON ถาวร
   - **NavIC (`IRS-1G/1I`, `IRS-2G/2I`):** หันแกน $+Z$ ชี้จุดเป้าหมายคงที่เหนืออินเดีย $(5^\circ\text{N}, 83^\circ\text{E})$ ทำให้มีมุมชดเชย pitch/roll/yaw เล็กน้อยตลอดเวลา; **ข้อควรระวัง:** ISRO ยังไม่เปิดเผยเกณฑ์ $|\beta|$ สำหรับสลับเข้า ON หรือกฎช่วง eclipse อย่างเป็นทางการ โดยเฉพาะรุ่นใหม่ NVS-01/02 (`IRS-2*`) จึงต้องระบุเป็นค่าประมาณการในโค้ด

3. **ข้อควรระวังในการต่อกับโมเดล `.glb` ของโปรเจกต์:** โมเดล `.glb` ทั้งหมดสร้างโดยหันหน้าโซลาร์เซลล์ไปทาง `-X_model` (`cell_side="-x"`) ซึ่งตรงข้ามกับ $+X_B$ จึงต้องหมุนโมเดลหลัก $180^\circ$ รอบแกน $+Z_B$ (ตาม [`models/galileo-foc/NOTES.md`](file:///Users/phuwish/SSSGMAT/.worktrees/gnss-studio-models/api-interop/gnss-predict/models/galileo-foc/NOTES.md)) หรือชดเชยมุมปีก $+180^\circ$ และใช้ชื่อ node `solar_wing_±Y` สำหรับ `galileo-foc` กับ `wing±Y` สำหรับรุ่นอื่น ๆ
