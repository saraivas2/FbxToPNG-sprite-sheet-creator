import os
import subprocess
from flask import Flask, request, send_from_directory
from werkzeug.utils import secure_filename

# Caminho para o executável do Blender NO SERVIDOR
BLENDER_PATH = "C:/Program Files/Blender Foundation/Blender 4.3/blender.exe" 
# ou "/usr/bin/blender" em Linux

UPLOAD_FOLDER = 'temp_uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

@app.route('/process-model', methods=['POST'])
def process_model():
    if 'model' not in request.files or 'texture' not in request.files:
        return "Erro: Faltando arquivo de modelo ou textura", 400

    model_file = request.files['model']
    texture_file = request.files['texture']

    # --- Salva os arquivos no servidor ---
    model_filename = secure_filename(model_file.filename)
    texture_filename = secure_filename(texture_file.filename)
    
    fbx_input_path = os.path.join(app.config['UPLOAD_FOLDER'], model_filename)
    texture_input_path = os.path.join(app.config['UPLOAD_FOLDER'], texture_filename)
    
    model_file.save(fbx_input_path)
    texture_file.save(texture_input_path)

    # --- Prepara para a conversão ---
    output_filename = model_filename.replace('.fbx', '.glb')
    glb_output_path = os.path.join(app.config['UPLOAD_FOLDER'], output_filename)

    # --- Script Python para o Blender ---
    # Este script precisa ser mais robusto para encontrar e aplicar a textura
    script_expr = (
        f"import bpy; "
        f"bpy.ops.wm.read_factory_settings(use_empty=True); "
        f"bpy.ops.import_scene.fbx(filepath=r'{fbx_input_path}'); "
        # A lógica para aplicar a textura é mais complexa, este é um exemplo simples
        f"mat = bpy.data.materials[0]; "
        f"mat.use_nodes = True; "
        f"bsdf = mat.node_tree.nodes['Principled BSDF']; "
        f"tex_image = mat.node_tree.nodes.new('ShaderNodeTexImage'); "
        f"tex_image.image = bpy.data.images.load(r'{texture_input_path}'); "
        f"mat.node_tree.links.new(bsdf.inputs['Base Color'], tex_image.outputs['Color']); "
        # Exporta a cena para GLB
        f"bpy.ops.export_scene.gltf(filepath=r'{glb_output_path}', export_format='GLB'); "
    )

    try:
        # --- Executa o comando do Blender ---
        print("Executando Blender...")
        command = [BLENDER_PATH, "--background", "--python-expr", script_expr]
        subprocess.run(command, check=True, capture_output=True, text=True)
        print(f"✅ Convertido com sucesso para: {glb_output_path}")

        # --- Envia o arquivo resultante de volta para o cliente ---
        return send_from_directory(app.config['UPLOAD_FOLDER'], output_filename, as_attachment=True)

    except subprocess.CalledProcessError as e:
        print("Erro durante a execução do Blender:")
        print(e.stdout)
        print(e.stderr)
        return f"Erro no servidor ao processar o modelo: {e.stderr}", 500
    except Exception as e:
        print(f"Erro inesperado: {e}")
        return f"Erro inesperado no servidor: {e}", 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)