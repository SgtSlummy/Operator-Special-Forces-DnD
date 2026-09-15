#!/usr/bin/env bash
set -euo pipefail

BASE_MODEL="${BASE_MODEL:-/models/checkpoints/sd_xl_base_1.0.safetensors}"
TRAIN_DIR="${TRAIN_DIR:-/data/dataset}"
OUTPUT_DIR="${OUTPUT_DIR:-/data/output}"
MODEL_NAME="${MODEL_NAME:-dndforge-style}"
EPOCHS="${EPOCHS:-10}"
NETWORK_DIM="${NETWORK_DIM:-32}"
NETWORK_ALPHA="${NETWORK_ALPHA:-16}"
LEARNING_RATE="${LEARNING_RATE:-1e-4}"

if [[ ! -f "$BASE_MODEL" ]]; then
  echo "Base checkpoint not found: $BASE_MODEL" >&2
  echo "Download SDXL or set BASE_MODEL to a mounted .safetensors file." >&2
  exit 2
fi
if [[ ! -d "$TRAIN_DIR" ]]; then
  echo "Training directory not found: $TRAIN_DIR" >&2
  exit 2
fi
mkdir -p "$OUTPUT_DIR"

cd /opt/sd-scripts
exec accelerate launch --num_cpu_threads_per_process 1 sdxl_train_network.py \
  --pretrained_model_name_or_path="$BASE_MODEL" \
  --train_data_dir="$TRAIN_DIR" \
  --output_dir="$OUTPUT_DIR" \
  --output_name="$MODEL_NAME" \
  --save_model_as=safetensors \
  --network_module=networks.lora \
  --network_dim="$NETWORK_DIM" \
  --network_alpha="$NETWORK_ALPHA" \
  --learning_rate="$LEARNING_RATE" \
  --unet_lr="$LEARNING_RATE" \
  --optimizer_type=AdamW8bit \
  --lr_scheduler=constant \
  --max_train_epochs="$EPOCHS" \
  --save_every_n_epochs=1 \
  --mixed_precision=fp16 \
  --save_precision=fp16 \
  --train_batch_size=1 \
  --gradient_checkpointing \
  --cache_latents \
  --cache_latents_to_disk \
  --cache_text_encoder_outputs \
  --cache_text_encoder_outputs_to_disk \
  --network_train_unet_only \
  --enable_bucket \
  --min_bucket_reso=512 \
  --max_bucket_reso=1536 \
  --bucket_reso_steps=64 \
  --bucket_no_upscale \
  --caption_extension=.txt \
  --seed=42 \
  --sdpa \
  --no_half_vae
