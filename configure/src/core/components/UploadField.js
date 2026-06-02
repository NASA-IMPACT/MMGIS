import React, { useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { uploadCardImage } from '../cardUpload';

// A config field that uploads an image and stores the returned mission-relative
// path. `value` is the current stored path (may be empty). On success it calls
// onChange(path); on failure it calls onError(message) and keeps the old value.
export default function UploadField({
    label,
    description,
    value,
    mission,
    disabled,
    domain,
    onChange,
    onError,
}) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);

    const handleSelect = async (e) => {
        const file = e.target.files && e.target.files[0];
        // Reset the input so selecting the same file again re-triggers change.
        e.target.value = '';
        if (!file) return;
        if (!mission) {
            onError && onError('Save or select a mission before uploading.');
            return;
        }
        setUploading(true);
        try {
            const path = await uploadCardImage(file, mission);
            onChange && onChange(path);
        } catch (err) {
            onError && onError(err.message || 'Image upload failed');
        } finally {
            setUploading(false);
        }
    };

    // Build a preview URL for the current value (mission-relative path).
    const previewSrc =
        value && /^(https?:|data:|\/)/i.test(value)
            ? value
            : value
              ? `${domain || ''}Missions/${mission}/${value}`
              : '';

    return (
        <div style={disabled ? { opacity: 0.5 } : {}}>
            <Typography variant="caption">{label}</Typography>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    margin: '4px 0',
                }}
            >
                {previewSrc ? (
                    <img
                        src={previewSrc}
                        alt=""
                        style={{
                            width: 48,
                            height: 48,
                            objectFit: 'cover',
                            border: '1px solid #DFE1E2',
                            borderRadius: 2,
                        }}
                    />
                ) : null}
                <Button
                    variant="outlined"
                    size="small"
                    disabled={disabled || uploading}
                    onClick={() => inputRef.current && inputRef.current.click()}
                >
                    {uploading
                        ? 'Uploading…'
                        : value
                          ? 'Replace image'
                          : 'Upload image'}
                </Button>
                {value ? (
                    <Button
                        variant="text"
                        size="small"
                        disabled={disabled || uploading}
                        onClick={() => onChange && onChange('')}
                    >
                        Clear
                    </Button>
                ) : null}
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    style={{ display: 'none' }}
                    onChange={handleSelect}
                />
            </div>
            {description ? (
                <div
                    style={{ fontSize: 12, color: '#888' }}
                    dangerouslySetInnerHTML={{ __html: description }}
                />
            ) : null}
        </div>
    );
}
