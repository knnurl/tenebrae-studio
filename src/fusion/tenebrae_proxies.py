# Tenebrae proxies for Fusion.
# Reads profile.json from a Tenebrae export and builds one revolved solid body per printed part:
# the blank shell (faces, caps, bores, joint and seam planes) without the pattern, as true B-rep geometry.
# Use the bodies to design stems, spiders, clips and mounts; send the patterned STLs to the slicer.
#
# Install: Utilities > Add-Ins > Scripts and Add-Ins > + (next to My Scripts) > pick this folder. Then Run.
import json
import math
import traceback

import adsk.core
import adsk.fusion

MM = 0.1  # Fusion's API works in centimetres; profile.json is in millimetres


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        design = adsk.fusion.Design.cast(app.activeProduct)
        if not design:
            ui.messageBox('Open or create a design first.')
            return
        dlg = ui.createFileDialog()
        dlg.title = 'Open profile.json from a Tenebrae export'
        dlg.filter = 'Tenebrae profile (*.json)'
        if dlg.showOpen() != adsk.core.DialogResults.DialogOK:
            return
        with open(dlg.filename) as f:
            data = json.load(f)
        if data.get('format') != 'tenebrae-profile-1':
            ui.messageBox('This is not a Tenebrae profile.json.')
            return

        root = design.rootComponent
        occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = 'Tenebrae proxies'
        report = []
        for part in data['parts']:
            body, vol = build_part(comp, part)
            err = (vol - part['volume']) / part['volume'] * 100
            report.append('{}: {:.0f} mm3 (profile {:.0f} mm3, {:+.3f}%)'.format(part['name'], vol, part['volume'], err))
        ui.messageBox('Built {} bodies, axis = Z, light centre at the origin.\n\n{}'.format(len(data['parts']), '\n'.join(report)))
    except Exception:
        if ui:
            ui.messageBox('Tenebrae proxies failed:\n{}'.format(traceback.format_exc()))


def build_part(comp, part):
    sk = comp.sketches.add(comp.xZConstructionPlane)
    sk.name = part['name']
    sk.isComputeDeferred = True
    to_sk = lambda q: sk.modelToSketchSpace(adsk.core.Point3D.create(q[0] * MM, 0, q[1] * MM))
    lines, arcs = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs
    first = prev = None
    for seg in part['segments']:
        if seg['type'] == 'line':
            start = prev if prev is not None else to_sk(seg['a'])
            curve = lines.addByTwoPoints(start, to_sk(seg['b']))
            s, e = curve.startSketchPoint, curve.endSketchPoint
        else:
            curve = arcs.addByThreePoints(to_sk(seg['a']), to_sk(seg['m']), to_sk(seg['b']))
            s, e = ends_in_order(curve, to_sk(seg['a']))
            if prev is not None:
                sk.geometricConstraints.addCoincident(prev, s)
        if first is None:
            first = s
        prev = e
    sk.geometricConstraints.addCoincident(prev, first)
    sk.isComputeDeferred = False

    prof = max((sk.profiles.item(i) for i in range(sk.profiles.count)),
               key=lambda p: p.areaProperties().area)
    revs = comp.features.revolveFeatures
    inp = revs.createInput(prof, comp.zConstructionAxis, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    inp.setAngleExtent(False, adsk.core.ValueInput.createByString('360 deg'))
    feat = revs.add(inp)
    feat.name = part['name']
    body = feat.bodies.item(0)
    body.name = part['name']
    return body, body.volume / (MM ** 3)


def ends_in_order(arc, start_pt):
    s, e = arc.startSketchPoint, arc.endSketchPoint
    d = lambda p: p.geometry.distanceTo(start_pt)
    return (s, e) if d(s) <= d(e) else (e, s)
