# Fotos de muestra de los modelos con FONDO BLANCO (26/11/2026, Facu: «necesito que las imágenes sean con fondo blanco»).
#
# Coge los originales de Wikimedia (ver src/modelos.ts), recorta el vehículo con rembg, se queda solo con la mancha más
# grande (el vehículo: fuera farolas y coches sueltos) y lo centra sobre blanco en 900×600 (3:2, como la ficha).
#
# No va con la app: se lanza a mano, una vez, en un entorno aparte con rembg (pip install "rembg[cpu]"):
#   python scripts/fondo-blanco-modelos.py <carpeta originales> public/modelos
# Los originales se bajan de https://commons.wikimedia.org/wiki/Special:FilePath/<archivo>?width=1600 con el nombre
# <clave>.jpg de src/modelos.ts.
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage

ANCHO, ALTO = 900, 600
MARGEN = 0.06           # aire alrededor del vehículo, en fracción del lienzo

# Recorte previo (x0, y0, x1, y1 en fracción del original) cuando hay otros vehículos PEGADOS al nuestro, que la
# mancha más grande no separa. Se ajusta mirando la hoja de muestra que saca este script.
RECORTES: dict[str, tuple[float, float, float, float]] = {}

# Zonas que NO son el vehículo pero están pegadas a él (x0, y0, x1, y1 en fracción de la foto), medidas a ojo sobre
# el original el 26/11:
BORRAR: dict[str, list[tuple[float, float, float, float]]] = {
    # el camión aparcado detrás: asoma por detrás de la caja y su parachoques, por debajo de ella
    'eurocargo': [(0, 0, 0.173, 1), (0, 0.665, 0.215, 1)],
}


def mascara_vehiculo(img: Image.Image, sesion, borrar=()) -> np.ndarray:
    """Máscara 0-255 del vehículo: la de rembg, quedándose solo con la mancha más grande y sus huecos rellenos."""
    suave = np.asarray(remove(img, session=sesion, only_mask=True), dtype=np.uint8).copy()
    alto, ancho = suave.shape
    for x0, y0, x1, y1 in borrar:
        suave[round(y0 * alto):round(y1 * alto), round(x0 * ancho):round(x1 * ancho)] = 0
    dura = suave > 128
    etiquetas, n = ndimage.label(dura)
    if n == 0:
        raise ValueError('no se ha encontrado ningún vehículo')
    tamanos = ndimage.sum(dura, etiquetas, range(1, n + 1))
    grande = etiquetas == (int(np.argmax(tamanos)) + 1)
    grande = ndimage.binary_fill_holes(grande)
    # El borde suave de rembg, pero solo cerca de la mancha buena (2 px), para que el contorno no quede dentado.
    cerca = ndimage.binary_dilation(grande, iterations=2)
    return np.where(grande, 255, np.where(cerca, suave, 0)).astype(np.uint8)


def sobre_blanco(img: Image.Image, mascara: np.ndarray) -> Image.Image:
    ys, xs = np.nonzero(mascara > 8)
    caja = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    rgba = img.convert('RGBA')
    rgba.putalpha(Image.fromarray(mascara))
    pieza = rgba.crop(caja)
    hueco_w, hueco_h = ANCHO * (1 - 2 * MARGEN), ALTO * (1 - 2 * MARGEN)
    escala = min(hueco_w / pieza.width, hueco_h / pieza.height)
    pieza = pieza.resize((round(pieza.width * escala), round(pieza.height * escala)), Image.LANCZOS)
    lienzo = Image.new('RGB', (ANCHO, ALTO), 'white')
    lienzo.paste(pieza, ((ANCHO - pieza.width) // 2, (ALTO - pieza.height) // 2), pieza)
    return lienzo


def sesion_ligera(modelo: str):
    # El PC de la oficina va justo de memoria (26/11: 2,4 GB libres de 32): sin reserva de memoria de onnxruntime y
    # con 2 hilos. isnet (1024 px) no cupo; u2net (320 px) gasta mucho menos y basta para fotos que se ven en pequeño.
    import onnxruntime as ort
    o = ort.SessionOptions()
    o.enable_cpu_mem_arena = False
    o.enable_mem_pattern = False
    o.intra_op_num_threads = 2
    o.inter_op_num_threads = 1
    return new_session(modelo, sess_opts=o)


def main(origen: Path, destino: Path, modelo: str = 'u2net') -> None:
    sesion = sesion_ligera(modelo)
    destino.mkdir(parents=True, exist_ok=True)
    hechas = []
    for f in sorted(origen.glob('*.jpg')):
        img = Image.open(f).convert('RGB')
        img.thumbnail((1400, 1400), Image.LANCZOS)   # el resultado es de 900 px: más no hace falta y ahorra memoria
        if f.stem in RECORTES:
            x0, y0, x1, y1 = RECORTES[f.stem]
            img = img.crop((round(x0 * img.width), round(y0 * img.height), round(x1 * img.width), round(y1 * img.height)))
        final = sobre_blanco(img, mascara_vehiculo(img, sesion, BORRAR.get(f.stem, ())))
        final.save(destino / f.name, quality=85, optimize=True, progressive=True)
        hechas.append(final)
        print(f'{f.name}: {(destino / f.name).stat().st_size // 1024} KB')
    # Hoja con todas, para revisarlas de un vistazo (no se publica: va al lado de los originales).
    hoja = Image.new('RGB', (3 * 300 + 40, ((len(hechas) + 2) // 3) * 200 + 40), (200, 200, 200))
    for i, im in enumerate(hechas):
        hoja.paste(im.resize((300, 200)), (10 + (i % 3) * 310, 10 + (i // 3) * 210))
    hoja.save(origen.parent / 'hoja-muestra.jpg', quality=90)


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]), *sys.argv[3:4])
